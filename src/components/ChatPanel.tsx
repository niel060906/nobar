import React from 'react';
import { useRoomStore } from '../stores/useRoomStore';
import { Send, Clock } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface ChatPanelProps {
  onSend: (text: string) => void;
  onSendReaction: (reaction: string) => void;
}

const REACTIONS = ['❤️', '😂', '🔥', '😱', '👏', '💀'];

export default function ChatPanel({ onSend, onSendReaction }: ChatPanelProps) {
  const [chatMsg, setChatMsg] = useState('');
  const chat = useRoomStore(state => state.chat);
  const localUserId = useRoomStore(state => state.localUserId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMsg.trim()) return;
    onSend(chatMsg);
    setChatMsg('');
  };

  const formatTime = (seconds?: number) => {
    if (seconds === undefined) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 scrollbar-thin scrollbar-thumb-slate-700" ref={scrollRef}>
        {chat.length > 0 ? chat.map((msg) => (
          <div key={msg.id} className={`text-sm ${msg.type === 'system' ? 'text-slate-500 text-center italic' : ''}`}>
            {msg.type === 'user' && (
              <div className="mb-1 flex items-center gap-2">
                <span className={`font-medium ${msg.userId === localUserId ? 'text-blue-400' : 'text-slate-300'}`}>
                  {msg.displayName}
                </span>
                <span className="text-slate-600 text-[10px]">
                  {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
                {msg.mediaPosition !== undefined && (
                  <span className="text-blue-500/50 text-[10px] flex items-center gap-0.5 bg-blue-900/20 px-1 rounded">
                    <Clock size={10} /> {formatTime(msg.mediaPosition)}
                  </span>
                )}
              </div>
            )}
            <div className={`${msg.type === 'user' ? 'text-slate-200 bg-slate-800/50 p-2 rounded-lg inline-block' : 'text-xs'}`}>
              {msg.text}
            </div>
          </div>
        )) : (
          <div className="text-center text-slate-500 text-sm mt-10">
            No messages yet. Say hello!
          </div>
        )}
      </div>
      
      <div className="p-3 border-t border-slate-800 shrink-0 flex flex-col gap-2">
        <div className="flex justify-around bg-slate-950 p-1 rounded-lg">
          {REACTIONS.map(emoji => (
            <button
              key={emoji}
              onClick={() => onSendReaction(emoji)}
              className="text-lg hover:scale-125 transition-transform active:scale-90 p-1"
            >
              {emoji}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={chatMsg}
            onChange={e => setChatMsg(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
          />
          <button 
            type="submit" 
            disabled={!chatMsg.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white p-2 rounded-lg transition-colors flex items-center justify-center"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
