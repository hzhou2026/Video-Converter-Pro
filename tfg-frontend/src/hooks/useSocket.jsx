import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export const useSocket = () => {
  const [socket, setSocket] = useState(null);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    // Obtener o crear userId único para el cliente
    let storedUserId = localStorage.getItem('video-converter-user-id');
    
    if (!storedUserId) {
      // Generar nuevo userId único
      storedUserId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem('video-converter-user-id', storedUserId);
    }
    
    setUserId(storedUserId);

    // Detectar entorno
    const isDevelopment = import.meta.env.DEV;
    
    const socketUrl = isDevelopment 
      ? 'http://localhost:3000'
      : globalThis.location.origin;

    console.log('Connecting to Socket.IO:', socketUrl);
    console.log('User ID:', storedUserId);

    const newSocket = io(socketUrl, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
      auth: {
        userId: storedUserId
      }
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      
      // Identificar usuario al conectarse
      newSocket.emit('identify', storedUserId);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log('Socket reconnected after', attemptNumber, 'attempts');
      
      // Re-identificar usuario tras reconexión
      newSocket.emit('identify', storedUserId);
    });

    newSocket.on('cleanup-completed', (stats) => {
      console.log('Cleanup completed:', stats);
    });

    return () => {
      console.log('Closing socket connection');
      newSocket.close();
    };
  }, []);

  return { socket, userId };
};