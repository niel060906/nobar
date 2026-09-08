export class SyncEngine {
  private serverClockOffset: number = 0;
  private onDriftCorrection: (rate: number) => void;
  private onHardSeek: (position: number) => void;
  private syncInterval: number | null = null;
  private isBuffering: boolean = false;

  constructor(callbacks: {
    onDriftCorrection: (rate: number) => void;
    onHardSeek: (position: number) => void;
  }) {
    this.onDriftCorrection = callbacks.onDriftCorrection;
    this.onHardSeek = callbacks.onHardSeek;
  }

  setServerClockOffset(offset: number) {
    this.serverClockOffset = offset;
  }

  setBuffering(buffering: boolean) {
    this.isBuffering = buffering;
  }

  getServerTime(): number {
    return Date.now() + this.serverClockOffset;
  }

  getExpectedPosition(serverState: { position: number, updatedAt: number, playing: boolean, playbackRate: number }): number {
    if (!serverState.playing) {
      return serverState.position;
    }
    const now = this.getServerTime();
    const elapsed = (now - serverState.updatedAt) / 1000;
    return serverState.position + (elapsed * serverState.playbackRate);
  }

  checkDrift(
    currentVideoPosition: number, 
    serverState: { position: number, updatedAt: number, playing: boolean, playbackRate: number } | null,
    strictSync: boolean = false
  ) {
    if (!serverState || !serverState.playing || this.isBuffering) {
      if (serverState && !serverState.playing && Math.abs(currentVideoPosition - serverState.position) > 0.5) {
         this.onHardSeek(serverState.position);
      }
      return;
    }

    const expectedPosition = this.getExpectedPosition(serverState);
    const drift = currentVideoPosition - expectedPosition;
    const absDrift = Math.abs(drift);

    // Strict sync narrows thresholds
    const hardSeekThreshold = strictSync ? 0.3 : 0.8;
    const smallDriftThreshold = strictSync ? 0.05 : 0.15;

    if (absDrift > hardSeekThreshold) {
      // Aggressive correction: Hard seek
      this.onHardSeek(expectedPosition);
      this.onDriftCorrection(serverState.playbackRate); // Reset rate
    } else if (absDrift > smallDriftThreshold) {
      // Small drift: adaptive rate correction (0.95 - 1.05 limit)
      if (drift > 0) {
        // Video is ahead, slow down slightly
        this.onDriftCorrection(serverState.playbackRate * 0.95);
      } else {
        // Video is behind, speed up slightly
        this.onDriftCorrection(serverState.playbackRate * 1.05);
      }
    } else {
      // Synchronized
      this.onDriftCorrection(serverState.playbackRate);
    }
  }

  startSyncLoop(
    getVideoPosition: () => number,
    getServerState: () => { position: number, updatedAt: number, playing: boolean, playbackRate: number } | null,
    getStrictSync: () => boolean
  ) {
    this.stopSyncLoop();
    this.syncInterval = window.setInterval(() => {
      this.checkDrift(getVideoPosition(), getServerState(), getStrictSync());
    }, 1000);
  }

  stopSyncLoop() {
    if (this.syncInterval !== null) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}
