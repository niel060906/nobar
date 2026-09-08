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

async function startServer() {
  await initDb();

  const app = express();
  app.use(cors());
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  // REST API
  app.post('/api/rooms', async (req, res) => {
    const { mediaUrl, displayName } = req.body;
    const roomId = crypto.randomBytes(4).toString('hex');
    const ownerId = crypto.randomBytes(8).toString('hex');
    
    const initialMedia = mediaUrl ? {
      id: crypto.randomUUID(),
      url: mediaUrl,
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

  // Socket.IO
  io.on('connection', (socket) => {
    
    // Server Clock Sync
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

    const checkPermission = (roomId: string, userId: string, requireHost: boolean = false) => {
      const room = RoomManager.getRoom(roomId);
      if (!room) return false;
      const members = RoomManager.getRoomMembers(roomId);
      const user = members.find(m => m.userId === userId);
      if (!user) return false;
      
      if (requireHost) {
        return user.role === 'owner' || user.role === 'host' || user.role === 'co-host';
      }
      
      if (room.settings.hostOnlyControl) {
        return user.role === 'owner' || user.role === 'host' || user.role === 'co-host';
      }
      
      return true;
    };

    // Playback events
    socket.on('player:play', ({ roomId, userId, position }) => {
      if (checkPermission(roomId, userId)) {
        const room = RoomManager.updatePlayback(roomId, 'PLAYING', true, position, 1, Date.now());
        if (room) io.to(roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('player:pause', ({ roomId, userId, position }) => {
      if (checkPermission(roomId, userId)) {
        const room = RoomManager.updatePlayback(roomId, 'PAUSED', false, position, 1, Date.now());
        if (room) io.to(roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('player:seek', ({ roomId, userId, position }) => {
      if (checkPermission(roomId, userId)) {
        const r = RoomManager.getRoom(roomId);
        const room = RoomManager.updatePlayback(roomId, r?.status || 'SEEKING', r?.playing || false, position, r?.playbackRate || 1, Date.now());
        if (room) io.to(roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    // Queue events
    socket.on('queue:add', ({ roomId, userId, media }) => {
      const r = RoomManager.getRoom(roomId);
      if (r && (checkPermission(roomId, userId) || r.settings.allowViewerQueue)) {
        const mediaItem = { ...media, id: crypto.randomUUID(), addedBy: userId };
        const room = RoomManager.addMedia(roomId, mediaItem);
        if (room) io.to(roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('queue:remove', ({ roomId, userId, index }) => {
      if (checkPermission(roomId, userId)) {
        const room = RoomManager.removeMedia(roomId, index);
        if (room) io.to(roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('queue:next', ({ roomId, userId }) => {
      if (checkPermission(roomId, userId)) {
        const room = RoomManager.playNext(roomId);
        if (room) io.to(roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('queue:previous', ({ roomId, userId, currentPosition }) => {
      if (checkPermission(roomId, userId)) {
        const room = RoomManager.playPrevious(roomId, currentPosition);
        if (room) io.to(roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    socket.on('room:settings', ({ roomId, userId, settings }) => {
      if (checkPermission(roomId, userId, true)) { // Must be host/owner
        const room = RoomManager.updateSettings(roomId, settings);
        if (room) io.to(roomId).emit('room:sync', { roomState: room, serverTime: Date.now() });
      }
    });

    // Moderation
    socket.on('mod:kick', ({ roomId, userId, targetUserId }) => {
      if (checkPermission(roomId, userId, true)) {
        const members = RoomManager.getRoomMembers(roomId);
        const target = members.find(m => m.userId === targetUserId);
        if (target && target.role !== 'owner') {
          RoomManager.leaveRoom(roomId, targetUserId);
          io.to(target.socketId).emit('error', 'You have been kicked from the room');
          io.to(target.socketId).disconnectSockets(true);
          io.to(roomId).emit('participant:update', RoomManager.getRoomMembers(roomId));
        }
      }
    });

    socket.on('mod:ban', ({ roomId, userId, targetUserId }) => {
      if (checkPermission(roomId, userId, true)) {
        RoomManager.banUser(roomId, targetUserId);
        io.to(roomId).emit('participant:update', RoomManager.getRoomMembers(roomId));
      }
    });

    // Social
    socket.on('chat:message', ({ roomId, userId, text, mediaPosition }) => {
      const room = RoomManager.getRoom(roomId);
      if (room && !room.settings.allowChat && !checkPermission(roomId, userId, true)) return;

      const members = RoomManager.getRoomMembers(roomId);
      const user = members.find(m => m.userId === userId);
      if (user && !user.isMuted) {
        io.to(roomId).emit('chat:message', {
          id: crypto.randomUUID(),
          type: 'user',
          userId,
          displayName: user.displayName,
          text,
          timestamp: Date.now(),
          mediaPosition
        });
      }
    });

    socket.on('reaction:send', ({ roomId, userId, reaction }) => {
      const now = Date.now();
      let limit = reactionRateLimits.get(userId);
      if (!limit || now - limit.lastReset > 1000) {
        limit = { count: 0, lastReset: now };
      }
      
      if (limit.count < 5) {
        limit.count++;
        reactionRateLimits.set(userId, limit);
        io.to(roomId).emit('reaction:broadcast', { reaction, userId, id: crypto.randomUUID() });
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
      const info = RoomManager.getUserBySocket(socket.id);
      if (info) {
        info.user.status = 'offline';
        // Delay leave to allow reconnect
        setTimeout(() => {
          const check = RoomManager.getUserBySocket(info.user.socketId);
          if (check && check.user.status === 'offline') {
            const members = RoomManager.leaveRoom(info.roomId, info.user.userId);
            io.to(info.roomId).emit('participant:update', members);
            io.to(info.roomId).emit('chat:message', {
              id: crypto.randomUUID(),
              type: 'system',
              text: `${info.user.displayName} left the room`,
              timestamp: Date.now()
            });
          }
        }, 10000); // 10s grace period for reconnect
      }
    });
  });

  // Periodic Authoritative Sync (Heartbeat to all rooms)
  setInterval(() => {
    const now = Date.now();
    io.sockets.adapter.rooms.forEach((_, roomId) => {
      const room = RoomManager.getRoom(roomId);
      if (room && room.playing) {
         // Auto play next if ended (simple fallback check)
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
