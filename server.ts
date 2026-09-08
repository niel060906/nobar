import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import cors from 'cors';
import crypto from 'crypto';
import { initDb } from './src/server/db.ts';
import { RoomManager } from './src/server/roomManager.ts';
import { createServer as createViteServer } from 'vite';

const reactionRateLimits = new Map<string, { count: number; lastReset: number }>();
const chatRateLimits = new Map<string, { count: number; lastReset: number }>();

async function startServer() {
  await initDb();
  RoomManager.init();

  const app = express();
  app.use(cors());
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  // Memory leak cleanup for rate limit maps
  setInterval(() => {
    const now = Date.now();
    for (const [userId, limit] of reactionRateLimits.entries()) {
      if (now - limit.lastReset > 60000) reactionRateLimits.delete(userId);
    }
    for (const [userId, limit] of chatRateLimits.entries()) {
      if (now - limit.lastReset > 60000) chatRateLimits.delete(userId);
    }
  }, 60000);

  // REST API
  app.post('/api/rooms', async (req, res) => {
    const { mediaUrl, displayName, userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    
    const roomId = crypto.randomBytes(4).toString('hex');
    const ownerId = userId;
    
    let sanitizedMediaUrl = mediaUrl;
    if (sanitizedMediaUrl) {
      try {
        const url = new URL(sanitizedMediaUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return res.status(400).json({ error: 'Invalid URL protocol' });
        }
      } catch(e) {
        return res.status(400).json({ error: 'Invalid URL' });
      }
    }

    const initialMedia = sanitizedMediaUrl ? {
      id: crypto.randomUUID(),
      url: sanitizedMediaUrl,
      type: 'auto',
      title: 'Video',
      addedBy: ownerId
    } : null;

    RoomManager.createRoom(roomId, ownerId, initialMedia, displayName);
    res.json({ roomId, ownerId });
  });

  app.get('/api/rooms', (req, res) => {
    const rooms = RoomManager.getAllRooms().map(r => {
      const activeMembers = RoomManager.getRoomMembers(r.roomId).filter(m => m.status === 'online').length;
      return {
        roomId: r.roomId,
        status: r.status,
        participantCount: activeMembers,
        mediaTitle: r.queue[r.currentMediaIndex]?.title || 'No Media'
      };
    });
    res.json(rooms);
  });

  app.get('/api/rooms/:id', (req, res) => {
    const room = RoomManager.getRoom(req.params.id);
    if (room) {
      res.json({ ...room, members: RoomManager.getRoomMembers(req.params.id) });
    } else {
      res.status(404).json({ error: 'Room not found' });
    }
  });

  // Helper for auth validation based strictly on socket session
  const getAuth = (socketId: string) => {
    const info = RoomManager.getUserBySocket(socketId);
    return info;
  };

  const checkPermission = (info: any, requireHost: boolean = false) => {
    if (!info) return false;
    const { roomId, user } = info;
    const room = RoomManager.getRoom(roomId);
    if (!room) return false;
    
    if (requireHost) {
      return user.role === 'owner' || user.role === 'host' || user.role === 'co-host';
    }
    
    if (room.settings.hostOnlyControl) {
      return user.role === 'owner' || user.role === 'host' || user.role === 'co-host';
    }
    
    return true;
  };

  // Socket.IO
  io.on('connection', (socket) => {
    
    socket.on('ping', (clientTime, callback) => {
      if (typeof callback === 'function') {
        callback(clientTime, Date.now());
      }
    });

    socket.on('room:join', ({ roomId, userId, displayName }) => {
      const user = RoomManager.joinRoom(roomId, userId, socket.id, displayName);
      if (!user) {
        socket.emit('error', 'Room not found or you are banned');
        return;
      }
      
      socket.join(roomId);
      const room = RoomManager.getRoom(roomId);
      
      let currentPosition = room?.position || 0;
      if (room?.playing) {
        const elapsed = (Date.now() - room.updatedAt) / 1000;
        currentPosition += elapsed * room.playbackRate;
      }

      socket.emit('room:state', {
        ...room,
        position: currentPosition,
        serverTime: Date.now(),
        members: RoomManager.getRoomMembers(roomId)
      });
      
      io.to(roomId).emit('participant:update', RoomManager.getRoomMembers(roomId));
      io.to(roomId).emit('chat:message', {
        id: crypto.randomUUID(),
        type: 'system',
        text: `${displayName} joined the room`,
        timestamp: Date.now()
      });
    });

    // Playback events (Auth by socket ID)
    socket.on('player:play', ({ position }) => {
      const info = getAuth(socket.id);
      if (checkPermission(info)) {
        const r = RoomManager.getRoom(info.roomId);
        const room = RoomManager.updatePlayback(info.roomId, 'PLAYING', true, position, r?.playbackRate || 1, Date.now());
        if (room) io.to(info.roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('player:pause', ({ position }) => {
      const info = getAuth(socket.id);
      if (checkPermission(info)) {
        const r = RoomManager.getRoom(info.roomId);
        const room = RoomManager.updatePlayback(info.roomId, 'PAUSED', false, position, r?.playbackRate || 1, Date.now());
        if (room) io.to(info.roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('player:seek', ({ position }) => {
      const info = getAuth(socket.id);
      if (checkPermission(info)) {
        const r = RoomManager.getRoom(info.roomId);
        const room = RoomManager.updatePlayback(info.roomId, r?.status || 'SEEKING', r?.playing || false, position, r?.playbackRate || 1, Date.now());
        if (room) io.to(info.roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('player:rate', ({ rate, position }) => {
      const info = getAuth(socket.id);
      if (checkPermission(info)) {
        const r = RoomManager.getRoom(info.roomId);
        const room = RoomManager.updatePlayback(info.roomId, r?.status || 'PLAYING', r?.playing || false, position, rate, Date.now());
        if (room) io.to(info.roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('player:ended', () => {
       const info = getAuth(socket.id);
       if (checkPermission(info)) {
         const room = RoomManager.handleMediaEnded(info.roomId);
         if (room) io.to(info.roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
       }
    });

    // Queue events
    socket.on('queue:add', ({ media }) => {
      const info = getAuth(socket.id);
      if (!info) return;
      const r = RoomManager.getRoom(info.roomId);
      if (r && (checkPermission(info) || r.settings.allowViewerQueue)) {
        try {
          const url = new URL(media.url);
          if (['http:', 'https:'].includes(url.protocol)) {
            
            if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
               socket.emit('error', 'YouTube playback requires a specialized embed player (Not currently supported).');
               return;
            }
            if (url.hostname.includes('tiktok.com') || url.hostname.includes('instagram.com')) {
               socket.emit('error', 'This platform restricts direct video playback.');
               return;
            }

            const title = media.title !== 'Video' ? media.title : (url.pathname.split('/').pop() || 'Media Track');
            const type = url.pathname.includes('.m3u8') ? 'hls' : 'auto';

            const mediaItem = { ...media, url: url.toString(), id: crypto.randomUUID(), addedBy: info.user.userId, title, type };
            const room = RoomManager.addMedia(info.roomId, mediaItem);
            if (room) io.to(info.roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
          } else {
             socket.emit('error', 'Invalid URL protocol.');
          }
        } catch(e) {
             socket.emit('error', 'Invalid URL.');
        }
      }
    });

    socket.on('queue:remove', ({ index }) => {
      const info = getAuth(socket.id);
      if (checkPermission(info)) {
        const room = RoomManager.removeMedia(info.roomId, index);
        if (room) io.to(info.roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('queue:next', () => {
      const info = getAuth(socket.id);
      if (checkPermission(info)) {
        const room = RoomManager.playNext(info.roomId);
        if (room) io.to(info.roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('queue:previous', ({ currentPosition }) => {
      const info = getAuth(socket.id);
      if (checkPermission(info)) {
        const room = RoomManager.playPrevious(info.roomId, currentPosition);
        if (room) io.to(info.roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('room:settings', ({ settings }) => {
      const info = getAuth(socket.id);
      if (checkPermission(info, true)) {
        const room = RoomManager.updateSettings(info.roomId, settings);
        if (room) io.to(info.roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    // Moderation
    socket.on('mod:kick', ({ targetUserId }) => {
      const info = getAuth(socket.id);
      if (checkPermission(info, true)) {
        const members = RoomManager.getRoomMembers(info.roomId);
        const target = members.find(m => m.userId === targetUserId);
        if (target && target.role !== 'owner') {
          RoomManager.leaveRoom(info.roomId, targetUserId);
          io.to(target.socketId).emit('error', 'You have been kicked from the room');
          io.sockets.sockets.get(target.socketId)?.disconnect(true);
          io.to(info.roomId).emit('participant:update', RoomManager.getRoomMembers(info.roomId));
        }
      }
    });

    socket.on('mod:ban', ({ targetUserId }) => {
      const info = getAuth(socket.id);
      if (checkPermission(info, true)) {
        const room = RoomManager.banUser(info.roomId, targetUserId);
        if (room) {
           io.to(info.roomId).emit('participant:update', RoomManager.getRoomMembers(info.roomId));
           for (const [id, socketInstance] of io.sockets.sockets) {
              const checkInfo = RoomManager.getUserBySocket(id);
              if (checkInfo && checkInfo.user.userId === targetUserId) {
                 socketInstance.emit('error', 'You have been banned from this room');
                 socketInstance.disconnect(true);
              }
           }
        }
      }
    });

    socket.on('mod:role', ({ targetUserId, role }) => {
      const info = getAuth(socket.id);
      if (info && info.user.role === 'owner') {
        RoomManager.changeRole(info.roomId, targetUserId, role);
        io.to(info.roomId).emit('participant:update', RoomManager.getRoomMembers(info.roomId));
      }
    });

    // Social
    socket.on('chat:message', ({ text, mediaPosition }) => {
      const info = getAuth(socket.id);
      if (!info) return;
      
      const now = Date.now();
      let limit = chatRateLimits.get(info.user.userId);
      if (!limit || now - limit.lastReset > 2000) {
         limit = { count: 0, lastReset: now };
      }
      if (limit.count > 5) return;
      limit.count++;
      chatRateLimits.set(info.user.userId, limit);

      const room = RoomManager.getRoom(info.roomId);
      if (room && !room.settings.allowChat && !checkPermission(info, true)) return;

      if (!info.user.isMuted) {
        const sanitizedText = text.substring(0, 500).replace(/</g, "&lt;").replace(/>/g, "&gt;");
        io.to(info.roomId).emit('chat:message', {
          id: crypto.randomUUID(),
          type: 'user',
          userId: info.user.userId,
          displayName: info.user.displayName,
          text: sanitizedText,
          timestamp: Date.now(),
          mediaPosition
        });
      }
    });

    socket.on('reaction:send', ({ reaction }) => {
      const info = getAuth(socket.id);
      if (!info) return;

      const now = Date.now();
      let limit = reactionRateLimits.get(info.user.userId);
      if (!limit || now - limit.lastReset > 1000) {
        limit = { count: 0, lastReset: now };
      }
      
      if (limit.count < 5) {
        limit.count++;
        reactionRateLimits.set(info.user.userId, limit);
        io.to(info.roomId).emit('reaction:broadcast', { reaction, userId: info.user.userId, id: crypto.randomUUID() });
      }
    });

    socket.on('heartbeat', () => {
      const info = RoomManager.getUserBySocket(socket.id);
      if (info) {
        info.user.lastSeen = Date.now();
        info.user.status = 'online';
      }
    });

    socket.on('disconnect', () => {
      const info = RoomManager.handleDisconnect(socket.id);
      if (info) {
        io.to(info.roomId).emit('participant:update', RoomManager.getRoomMembers(info.roomId));
      }
    });
  });

  // Periodic Authoritative Sync (Heartbeat to all rooms)
  setInterval(() => {
    io.sockets.adapter.rooms.forEach((_, roomId) => {
      const room = RoomManager.getRoom(roomId);
      if (room) {
         io.to(roomId).emit('room:heartbeat', {
           sequence: room.sequence,
           playing: room.playing,
           position: room.position,
           playbackRate: room.playbackRate,
           updatedAt: room.updatedAt
         });
      }
    });
  }, 3000);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
