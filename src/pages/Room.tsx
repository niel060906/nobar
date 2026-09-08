import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { io, Socket } from 'socket.io-client';
import { useRoomStore } from '../stores/useRoomStore';
import UniversalPlayer from '../components/UniversalPlayer';
import ChatPanel from '../components/ChatPanel';
import QueuePanel from '../components/QueuePanel';
import ReactionLayer from '../components/ReactionLayer';
import { Users, MessageSquare, ListVideo, Copy, Play, Signal, Shield, QrCode } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const socketRef = useRef<Socket | null>(null);
  const videoPosRef = useRef<number>(0);
  
  const [mediaUrlInput, setMediaUrlInput] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'queue' | 'participants'>('chat');
  const [showQR, setShowQR] = useState(false);
  
  const store = useRoomStore();
  const userId = localStorage.getItem('watchparty_id') || '';
  const displayName = localStorage.getItem('watchparty_name') || '';

  useEffect(() => {
    if (!roomId || !userId || !displayName) {
      navigate('/');
      return;
    }

    store.setLocalUserId(userId);

    const socket = io();
    socketRef.current = socket;

    // Clock Sync Ping
    let clockSyncInterval: number;
    const syncClock = () => {
      const clientSent = Date.now();
      socket.emit('ping', clientSent, (sentTime: number, serverTime: number) => {
        const localNow = Date.now();
        const rtt = localNow - sentTime;
        const offset = serverTime - localNow + (rtt / 2);
        store.setSyncMetrics(offset, rtt);
      });
    };

    socket.on('connect', () => {
      store.setConnectionStatus(true);
      socket.emit('room:join', { roomId, userId, displayName });
      syncClock();
      clockSyncInterval = window.setInterval(syncClock, 5000);
    });

    socket.on('disconnect', () => {
      store.setConnectionStatus(false);
      clearInterval(clockSyncInterval);
    });

    socket.on('room:state', (data) => {
      store.setRoomState(data);
      if (data.members) store.setMembers(data.members);
    });

    socket.on('room:sync', ({ roomState }) => {
      store.setRoomState(roomState);
    });

    socket.on('room:heartbeat', (data) => {
      const room = store.roomState;
      if (room && data.sequence > room.sequence) {
        // We missed an event, could request full sync here
        store.setRoomState({ ...room, ...data });
      } else if (room && data.sequence === room.sequence && data.playing !== room.playing) {
        // Enforce authoritative state
        store.setRoomState({ ...room, ...data });
      }
    });

    socket.on('participant:update', (members) => {
      store.setMembers(members);
    });

    socket.on('chat:message', (msg) => {
      store.addChatMessage(msg);
    });

    socket.on('reaction:broadcast', ({ reaction, userId, id }) => {
       store.addReaction({ id, reaction, x: Math.random() * 80 + 10 });
    });

    socket.on('error', (msg) => {
      toast.error(msg);
      navigate('/');
    });

    const heartbeatInterval = setInterval(() => {
      if (socket.connected) socket.emit('heartbeat');
    }, 10000);

    return () => {
      clearInterval(heartbeatInterval);
      clearInterval(clockSyncInterval);
      socket.disconnect();
    };
  }, [roomId, userId, displayName, navigate]);

  const canControl = store.canControlPlayback();

  const handlePlay = (pos: number) => {
    socketRef.current?.emit('player:play', { position: pos });
  };

  const handlePause = (pos: number) => {
    socketRef.current?.emit('player:pause', { position: pos });
  };

  const handleSeek = (pos: number) => {
    socketRef.current?.emit('player:seek', { position: pos });
  };

  const handleRateChange = (rate: number) => {
    // Only handled locally for small drifts, unless we want to broadcast explicitly.
  };

  const addMediaToQueue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mediaUrlInput.trim()) return;
    
    socketRef.current?.emit('queue:add', { 
      media: { url: mediaUrlInput, type: 'auto', title: 'Video' } 
    });
    setMediaUrlInput('');
  };

  const copyRoomLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success('Room link copied!');
  };

  if (!store.isConnected && !store.roomState) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p>Connecting to room...</p>
      </div>
    );
  }

  const room = store.roomState;
  const currentMedia = room?.queue[room.currentMediaIndex];
  
  const getNetworkColor = () => {
    switch (store.networkQuality) {
      case 'EXCELLENT': return 'text-green-400';
      case 'GOOD': return 'text-lime-400';
      case 'FAIR': return 'text-yellow-400';
      case 'POOR': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col md:flex-row overflow-hidden font-sans">
      
      {/* Main Content (Player) */}
      <div className="flex-1 flex flex-col h-[60vh] md:h-screen relative">
        <ReactionLayer />
        
        {/* Header */}
        <header className="h-16 border-b border-slate-800 bg-slate-950 flex items-center justify-between px-4 shrink-0 z-10 relative">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600/20 p-2 rounded-lg text-blue-500">
              <Play size={20} className="fill-current" />
            </div>
            <div>
              <h1 className="font-semibold text-slate-100 leading-tight truncate max-w-[150px] sm:max-w-[300px]">
                {currentMedia?.title || 'Watch Party'}
              </h1>
              <div className="flex items-center gap-2 text-[10px] sm:text-xs font-mono">
                <span className="text-slate-500">Room: {roomId}</span>
                <span className={`flex items-center gap-1 ${getNetworkColor()}`}>
                  <Signal size={12} /> {store.networkQuality} ({store.rtt}ms)
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!store.isConnected && (
              <span className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded-full border border-red-500/20">
                Reconnecting...
              </span>
            )}
            <button onClick={() => setShowQR(!showQR)} className="p-2 text-slate-400 hover:text-white transition-colors">
              <QrCode size={18} />
            </button>
            <button 
              onClick={copyRoomLink}
              className="flex items-center gap-1.5 text-sm bg-slate-800 hover:bg-slate-700 transition-colors px-3 py-1.5 rounded-lg text-slate-300"
            >
              <Copy size={14} />
              <span className="hidden sm:inline">Copy Link</span>
            </button>
          </div>
          
          {showQR && (
            <div className="absolute top-16 right-4 bg-white p-4 rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in duration-200">
              <QRCodeSVG value={window.location.href} size={150} />
              <p className="text-slate-900 text-xs text-center mt-2 font-medium">Scan to join room</p>
            </div>
          )}
        </header>

        {/* Video Player Area */}
        <div className="flex-1 bg-black relative min-h-0 flex flex-col z-0">
          {currentMedia ? (
            <UniversalPlayer
              url={currentMedia.url}
              playing={room?.playing || false}
              playbackRate={room?.playbackRate || 1}
              serverState={room ? {
                position: room.position,
                updatedAt: room.updatedAt,
                playing: room.playing,
                playbackRate: room.playbackRate
              } : null}
              strictSync={room?.settings.strictSync || false}
              serverTimeOffset={store.serverTimeOffset}
              canControl={canControl}
              onPlay={handlePlay}
              onPause={handlePause}
              onSeek={(pos) => {
                videoPosRef.current = pos;
                handleSeek(pos);
              }}
              onRateChange={handleRateChange}
              onEnded={() => {
                // Auto next handled by server periodic check or user action
                if (canControl) socketRef.current?.emit('queue:next', { roomId, userId });
              }}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
              <ListVideo className="w-16 h-16 mb-4 opacity-50" />
              <p>Queue is empty</p>
              {(canControl || room?.settings.allowViewerQueue) && <p className="text-sm mt-2">Add a video below to start watching</p>}
            </div>
          )}
        </div>

        {/* Host Controls */}
        {(canControl || room?.settings.allowViewerQueue) && (
          <div className="p-4 border-t border-slate-800 bg-slate-900 shrink-0 z-10 relative">
            <form onSubmit={addMediaToQueue} className="flex gap-2">
              <input
                type="url"
                value={mediaUrlInput}
                onChange={e => setMediaUrlInput(e.target.value)}
                placeholder="Enter video URL to add to queue..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
              />
              <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                Add to Queue
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="w-full md:w-80 h-[40vh] md:h-screen border-t md:border-t-0 md:border-l border-slate-800 bg-slate-900 flex flex-col shrink-0 z-10 relative">
        
        {/* Tabs */}
        <div className="flex border-b border-slate-800 shrink-0">
          <button 
            className={`flex-1 py-3 text-xs font-medium flex items-center justify-center gap-1.5 ${activeTab === 'chat' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare size={14} /> Chat
          </button>
          <button 
            className={`flex-1 py-3 text-xs font-medium flex items-center justify-center gap-1.5 ${activeTab === 'queue' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setActiveTab('queue')}
          >
            <ListVideo size={14} /> Queue ({room?.queue.length || 0})
          </button>
          <button 
            className={`flex-1 py-3 text-xs font-medium flex items-center justify-center gap-1.5 ${activeTab === 'participants' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setActiveTab('participants')}
          >
            <Users size={14} /> Users ({store.members.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden relative">
          {activeTab === 'chat' && (
            <ChatPanel 
              onSend={(text) => {
                const pos = store.roomState?.playing ? syncEngineMockGetPos(store.roomState, store.serverTimeOffset) : store.roomState?.position;
                socketRef.current?.emit('chat:message', { roomId, userId, text, mediaPosition: pos });
              }}
              onSendReaction={(reaction) => socketRef.current?.emit('reaction:send', { roomId, userId, reaction })}
            />
          )}
          {activeTab === 'queue' && (
            <QueuePanel 
              onRemove={(idx) => socketRef.current?.emit('queue:remove', { roomId, userId, index: idx })}
              onPlayNext={() => socketRef.current?.emit('queue:next', { roomId, userId })}
              onPlayPrevious={() => socketRef.current?.emit('queue:previous', { roomId, userId, currentPosition: videoPosRef.current })}
            />
          )}
          {activeTab === 'participants' && (
            <div className="h-full overflow-y-auto p-4 flex flex-col gap-2 scrollbar-thin scrollbar-thumb-slate-700">
              {store.members.map((member) => (
                <div key={member.userId} className="flex items-center gap-3 p-2 rounded-lg bg-slate-800/50 group">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center font-semibold text-slate-300 text-xs">
                    {member.displayName.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-200 truncate flex items-center gap-2">
                      {member.displayName}
                      {member.userId === userId && <span className="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">You</span>}
                    </div>
                    <div className="text-xs text-slate-500 capitalize flex items-center gap-1">
                      {member.role === 'owner' ? <Shield size={10} className="text-yellow-500" /> : null}
                      {member.role} {member.role === 'host' && '👑'}
                    </div>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${member.status === 'online' ? 'bg-green-500' : 'bg-slate-500'}`}></div>
                  
                  {/* Moderation Controls */}
                  {store.isHostOrOwner() && member.userId !== userId && member.role !== 'owner' && (
                    <div className="hidden group-hover:flex items-center gap-1">
                      <button onClick={() => socketRef.current?.emit('mod:kick', { roomId, userId, targetUserId: member.userId })} className="text-xs text-red-400 bg-red-400/10 hover:bg-red-400/20 px-2 py-1 rounded">Kick</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper for chat timestamp calculation
function syncEngineMockGetPos(serverState: any, offset: number) {
  if (!serverState.playing) return serverState.position;
  const now = Date.now() + offset;
  const elapsed = (now - serverState.updatedAt) / 1000;
  return serverState.position + (elapsed * serverState.playbackRate);
}
