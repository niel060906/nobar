import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Video, Users, Play, LogIn, MonitorPlay } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { motion } from 'motion/react';

interface ActiveRoom {
  roomId: string;
  status: string;
  participantCount: number;
  mediaTitle: string;
}

export default function Home() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  
  const [mediaUrl, setMediaUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  useEffect(() => {
    fetch('/api/rooms')
      .then(res => res.json())
      .then(data => {
        setActiveRooms(data);
        setLoadingRooms(false);
      })
      .catch(err => {
        console.error('Failed to load rooms', err);
        setLoadingRooms(false);
      });
  }, []);
  
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return toast.error('Display name is required');
    
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaUrl, displayName })
      });
      const data = await res.json();
      
      // Store user identity
      localStorage.setItem('watchparty_name', displayName);
      localStorage.setItem(`watchparty_role_${data.roomId}`, 'host');
      localStorage.setItem(`watchparty_id`, localStorage.getItem('watchparty_id') || crypto.randomUUID());
      
      navigate(`/room/${data.roomId}`);
    } catch (err) {
      toast.error('Failed to create room');
    }
  };

  const handleJoin = (e: React.FormEvent, roomIdOverride?: string) => {
    if (e) e.preventDefault();
    const targetRoomId = roomIdOverride || joinRoomId;
    if (!displayName.trim()) {
      if (roomIdOverride) {
        setJoinRoomId(roomIdOverride);
        setTab('join');
      }
      return toast.error('Display name is required to join');
    }
    if (!targetRoomId.trim()) return toast.error('Room ID is required');
    
    localStorage.setItem('watchparty_name', displayName);
    localStorage.setItem(`watchparty_id`, localStorage.getItem('watchparty_id') || crypto.randomUUID());
    
    navigate(`/room/${targetRoomId}`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20 mb-4">
            <Video size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Watch Party</h1>
          <p className="text-slate-400 mt-2 text-center">Watch videos together in real-time, synchronized perfectly across all devices.</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          <div className="flex border-b border-slate-800">
            <button 
              className={`flex-1 py-4 flex items-center justify-center gap-2 font-medium transition-colors ${tab === 'create' ? 'bg-slate-800/50 text-blue-400 border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => setTab('create')}
            >
              <Play size={18} />
              Create Room
            </button>
            <button 
              className={`flex-1 py-4 flex items-center justify-center gap-2 font-medium transition-colors ${tab === 'join' ? 'bg-slate-800/50 text-blue-400 border-b-2 border-blue-500' : 'text-slate-400 hover:text-slate-200'}`}
              onClick={() => setTab('join')}
            >
              <LogIn size={18} />
              Join Room
            </button>
          </div>

          <div className="p-6">
            {tab === 'create' ? (
              <form onSubmit={handleCreate} className="flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Your Name</label>
                  <input 
                    type="text" 
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Enter your display name"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Video URL (Optional)</label>
                  <input 
                    type="url" 
                    value={mediaUrl}
                    onChange={e => setMediaUrl(e.target.value)}
                    placeholder="https://example.com/video.mp4"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                  <p className="text-xs text-slate-500 mt-2">Supports MP4, HLS (.m3u8), and direct video links.</p>
                </div>
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-3 font-semibold transition-colors mt-2 shadow-lg shadow-blue-600/20">
                  Create Watch Party
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => handleJoin(e)} className="flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Your Name</label>
                  <input 
                    type="text" 
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="Enter your display name"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Room Code</label>
                  <input 
                    type="text" 
                    value={joinRoomId}
                    onChange={e => setJoinRoomId(e.target.value)}
                    placeholder="e.g. abc123def456"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono"
                    required
                  />
                </div>
                <button type="submit" className="w-full bg-slate-100 hover:bg-white text-slate-900 rounded-xl py-3 font-semibold transition-colors mt-2">
                  Join Room
                </button>
              </form>
            )}
          </div>
          
          {/* Active Rooms List */}
          <div className="border-t border-slate-800 bg-slate-900/50 p-6">
            <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <MonitorPlay size={16} /> Active Rooms
            </h3>
            {loadingRooms ? (
              <div className="text-sm text-slate-500 text-center py-4 animate-pulse">Loading rooms...</div>
            ) : activeRooms.length === 0 ? (
              <div className="text-sm text-slate-500 text-center py-4 bg-slate-950/50 rounded-xl border border-slate-800/50">
                No active rooms right now. Be the first to create one!
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 pr-2">
                {activeRooms.map(room => (
                  <button 
                    key={room.roomId}
                    onClick={(e) => handleJoin(e, room.roomId)}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-blue-500/50 hover:bg-slate-900 transition-all text-left group"
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="text-sm font-medium text-slate-200 truncate group-hover:text-blue-400 transition-colors">
                        {room.mediaTitle}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {room.roomId}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded-full shrink-0">
                      <Users size={12} />
                      {room.participantCount}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <div className="mt-8 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
          <Users size={16} />
          <span>Real-time playback synchronization</span>
        </div>
      </motion.div>
    </div>
  );
}
