import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

/**
 * Custom hook para manejar la conexión WebSocket
 * @param {string} url - URL del servidor Socket.IO
 * @returns {Socket|null} - Instancia del socket o null si no está conectado
 */
export const useSocket = (url) => {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const newSocket = io(url, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
    });

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    return () => {
      newSocket.close();
    };
  }, [url]);

  return socket;
};