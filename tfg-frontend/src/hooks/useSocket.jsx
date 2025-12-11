import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

/**
 * Custom hook para manejar la conexión WebSocket
 * Detecta automáticamente si está en desarrollo o producción
 */
export const useSocket = () => {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Detectar entorno
    const isDevelopment = import.meta.env.DEV;
    
    // En desarrollo: conectar directamente al backend
    // En producción con Docker: nginx hace proxy de /socket.io/
    const socketUrl = isDevelopment 
      ? 'http://localhost:3000'
      : globalThis.location.origin;  // Usa la misma URL del frontend

    console.log('Connecting to Socket.IO:', socketUrl);

    const newSocket = io(socketUrl, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling']  // Probar websocket primero
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