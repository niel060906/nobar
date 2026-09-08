import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { SyncEngine } from '../player/SyncEngine';

interface UniversalPlayerProps {
  url: string;
  playing: boolean;
  playbackRate: number;
  serverState: {
    position: number;
    updatedAt: number;
    playing: boolean;
    playbackRate: number;
  } | null;
  strictSync: boolean;
  serverTimeOffset: number;
  canControl: boolean;
  onPlay: (position: number) => void;
  onPause: (position: number) => void;
  onSeek: (position: number) => void;
  onRateChange: (rate: number) => void;
  onEnded: () => void;
}

export default function UniversalPlayer({
  url,
  playing,
  playbackRate,
  serverState,
  strictSync,
  serverTimeOffset,
  canControl,
  onPlay,
  onPause,
  onSeek,
  onRateChange,
  onEnded
}: UniversalPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  
  const syncEngineRef = useRef<SyncEngine>(
    new SyncEngine({
      onDriftCorrection: (rate) => {
        if (videoRef.current) videoRef.current.playbackRate = rate;
      },
      onHardSeek: (pos) => {
        if (videoRef.current) {
          // Only hard seek if diff is substantial to avoid micro-stutters
          if (Math.abs(videoRef.current.currentTime - pos) > 0.5) {
             videoRef.current.currentTime = pos;
          }
        }
      }
    })
  );

  useEffect(() => {
    syncEngineRef.current.setServerClockOffset(serverTimeOffset);
  }, [serverTimeOffset]);

  useEffect(() => {
    syncEngineRef.current.setBuffering(isBuffering);
  }, [isBuffering]);

  // Tab visibility resync
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && serverState && videoRef.current) {
        // Force resync on return
        const engine = syncEngineRef.current;
        const expected = engine.getExpectedPosition(serverState);
        videoRef.current.currentTime = expected;
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [serverState]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setIsBuffering(true);

    const initPlayer = () => {
      const isM3u8 = url.includes('.m3u8') || url.includes('application/x-mpegURL');
      
      if (isM3u8 && Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          liveSyncDuration: 3,
          liveMaxLatencyDuration: 10,
        });
        hlsRef.current = hls;
        
        hls.loadSource(url);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                setError("Network error encountered, trying to recover...");
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                setError("Media error encountered, recovering...");
                hls.recoverMediaError();
                break;
              default:
                setError("Cannot play this video. It may be broken or restricted by CORS.");
                hls.destroy();
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      } else {
        video.src = url;
      }
    };

    if (url) {
      initPlayer();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) {
        video.src = '';
        video.removeAttribute('src');
      }
    };
  }, [url]);

  // Synchronize playback state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (playing && video.paused) {
      video.play().catch(e => {
        console.warn("Autoplay prevented or buffering", e);
      });
    } else if (!playing && !video.paused) {
      video.pause();
    }
  }, [playing, serverState?.updatedAt]); // Re-evaluate if server state time changes

  // Sync loop
  useEffect(() => {
    const engine = syncEngineRef.current;
    engine.startSyncLoop(
      () => videoRef.current?.currentTime || 0,
      () => serverState,
      () => strictSync
    );
    return () => engine.stopSyncLoop();
  }, [serverState, strictSync]);

  const handlePlay = () => {
    if (canControl && videoRef.current) onPlay(videoRef.current.currentTime);
    // If strict sync and cannot control, pause immediately
    else if (strictSync && !playing && videoRef.current) videoRef.current.pause();
  };

  const handlePause = () => {
    if (canControl && videoRef.current) onPause(videoRef.current.currentTime);
    else if (strictSync && playing && videoRef.current) videoRef.current.play().catch(()=>{});
  };

  const handleSeeked = () => {
    if (canControl && videoRef.current) {
      onSeek(videoRef.current.currentTime);
    } else if (strictSync && serverState && videoRef.current) {
      // Revert seek if strict sync enabled
      videoRef.current.currentTime = syncEngineRef.current.getExpectedPosition(serverState);
    }
  };

  const handleRateChange = () => {
    if (canControl && videoRef.current) {
      const currentRate = videoRef.current.playbackRate;
      if (Math.abs(currentRate - playbackRate) > 0.1) onRateChange(currentRate);
    }
  };

  const handleWaiting = () => setIsBuffering(true);
  const handleCanPlay = () => setIsBuffering(false);
  const handleEnded = () => {
    if (canControl) onEnded();
  };

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-slate-300 p-6 text-center z-20">
          <div className="text-red-400 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <p className="text-lg font-medium">{error}</p>
        </div>
      )}

      {isBuffering && !error && (
        <div className="absolute top-4 left-4 bg-black/60 backdrop-blur text-xs px-3 py-1.5 rounded-full text-white/80 border border-white/10 z-10 flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-white/80 border-t-transparent rounded-full animate-spin"></div>
          Buffering...
        </div>
      )}
      
      <video
        ref={videoRef}
        className="w-full h-full max-h-full object-contain"
        controls={canControl}
        playsInline
        onPlay={handlePlay}
        onPause={handlePause}
        onSeeked={handleSeeked}
        onRateChange={handleRateChange}
        onWaiting={handleWaiting}
        onCanPlay={handleCanPlay}
        onPlaying={handleCanPlay}
        onEnded={handleEnded}
        onError={() => setError("Video failed to load. The URL might be invalid or protected by CORS.")}
      />
      
      {!canControl && (
        <div className="absolute top-4 right-4 bg-black/60 backdrop-blur text-xs px-3 py-1.5 rounded-full text-white/80 border border-white/10 z-10">
          Viewing Mode (Host controls playback)
        </div>
      )}
    </div>
  );
}
