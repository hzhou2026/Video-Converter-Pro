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
      ? `http://${globalThis.location.hostname}:3000`
      : globalThis.location.origin;

    // Función para generar UUID compatible
    const generateUUID = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }

      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceALL(/[xy]/g, (c) => {
        const r = Math.trunc(Math.random() * 16);
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };

    // Obtener o generar sessionId
    const getSessionId = () => {
      let sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        sessionId = generateUUID();
        localStorage.setItem('sessionId', sessionId);
      }
      return sessionId;
    };

    const sessionId = getSessionId();

    console.log('Connecting to Socket.IO:', socketUrl);
    console.log('Using sessionId:', sessionId);

    // Crear la conexión del socket
    const newSocket = io(socketUrl, {
      auth: {
        sessionId
      },
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

