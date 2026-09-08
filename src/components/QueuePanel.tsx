import { useRoomStore } from '../stores/useRoomStore';
import { Play, Trash2, ListVideo } from 'lucide-react';

interface QueuePanelProps {
  onRemove: (index: number) => void;
  onPlayNext: () => void;
  onPlayPrevious: () => void;
}

export default function QueuePanel({ onRemove, onPlayNext, onPlayPrevious }: QueuePanelProps) {
  const roomState = useRoomStore(state => state.roomState);
  const canControl = useRoomStore(state => state.canControlPlayback());
  
  if (!roomState) return null;

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 p-4">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <ListVideo size={16} /> Playlist Queue
        </h2>
        {canControl && (
          <div className="flex gap-2">
            <button onClick={onPlayPrevious} className="text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-slate-300">Prev</button>
            <button onClick={onPlayNext} className="text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-slate-300">Next</button>
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 flex flex-col gap-2">
        {roomState.queue.length === 0 ? (
          <div className="text-slate-500 text-sm text-center mt-10">Queue is empty</div>
        ) : (
          roomState.queue.map((media, index) => {
            const isPlaying = index === roomState.currentMediaIndex;
            return (
              <div 
                key={`${media.id}-${index}`} 
                className={`flex items-center justify-between p-3 rounded-lg text-sm ${isPlaying ? 'bg-blue-900/30 border border-blue-500/30' : 'bg-slate-800/50'}`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  {isPlaying ? (
                    <Play size={14} className="text-blue-400 shrink-0" />
                  ) : (
                    <span className="text-slate-500 text-xs w-3 text-center">{index + 1}</span>
                  )}
                  <span className={`truncate ${isPlaying ? 'text-blue-200 font-medium' : 'text-slate-300'}`}>
                    {media.url}
                  </span>
                </div>
                {canControl && !isPlaying && (
                  <button 
                    onClick={() => onRemove(index)}
                    className="text-slate-500 hover:text-red-400 p-1 shrink-0 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
