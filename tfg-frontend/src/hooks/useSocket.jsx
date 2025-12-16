import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

// Custom hook para manejar la conexión WebSocket
export const useSocket = () => {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Detectar entorno
    const isDevelopment = import.meta.env.DEV;

    // Configurar la URL del socket según el entorno
    const socketUrl = isDevelopment
      ? `http://${window.location.hostname}:3000`
      : globalThis.location.origin;

    console.log('Connecting to Socket.IO:', socketUrl);

    const newSocket = io(socketUrl, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling']
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
    });

    newSocket.on('reconnect', (attemptNumber) => {
      console.log('Socket reconnected after', attemptNumber, 'attempts');
    });

    return () => {
      console.log('Closing socket connection');
      newSocket.close();
    };
  }, []);

  return socket;
};