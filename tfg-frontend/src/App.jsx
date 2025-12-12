import React, { useState, useEffect, useCallback } from 'react';
import UploadForm from './componentes/UploadForm';
import ProgressBar from './componentes/ProgressBar';
import { useSocket } from './hooks/useSocket';
import { api } from './servicios/api';
import './App.css';

const TABS = [
  { key: 'upload', label: 'Subir y Convertir', icon: '📤' },
  { key: 'jobs', label: 'Trabajos', icon: '⚙️' },
];

function App() {
  const { socket, userId } = useSocket();
  
  const [jobs, setJobs] = useState([]);
  const [activeTab, setActiveTab] = useState('upload');
  const [presets, setPresets] = useState({});
  const [formats, setFormats] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);
  const [downloadedJobs, setDownloadedJobs] = useState(new Set());

  // Cargar datos iniciales
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [presetsData, formatsData, jobsData, healthData] = await Promise.all([
          api.fetchPresets(),
          api.fetchFormats(),
          api.fetchJobs(),
          api.fetchSystemHealth()
        ]);
        
        setPresets(presetsData);
        setFormats(formatsData);
        setJobs(jobsData);
        setSystemHealth(healthData);
        
        console.log('Initial data loaded');
      } catch (error) {
        console.error('Error loading initial data:', error);
      }
    };

    loadInitialData();
  }, []);

  // Actualizar estado de un job
  const handleJobUpdate = useCallback((updatedJob) => {
    const jobId = updatedJob.id || updatedJob.jobId;

    setJobs(prevJobs => {
      const jobIndex = prevJobs.findIndex(j => j.id === jobId);

      if (jobIndex !== -1) {
        const newJobs = [...prevJobs];
        newJobs[jobIndex] = { ...newJobs[jobIndex], ...updatedJob, id: jobId };
        return newJobs;
      }

      return [...prevJobs, { ...updatedJob, id: jobId }];
    });
  }, []);

  // Configurar listeners de socket
  useEffect(() => {
    if (!socket) return;

    console.log('Setting up socket listeners');
    
    socket.on('job:update', handleJobUpdate);
    
    socket.on('job:warning', (data) => {
      console.warn('Job warning:', data);
    });

    return () => {
      socket.off('job:update', handleJobUpdate);
      socket.off('job:warning');
    };
  }, [socket, handleJobUpdate]);

  // Crear nuevo job
  const handleJobCreated = useCallback((response) => {
    const newJob = {
      id: response.jobId,
      status: response.status || 'queued',
      progress: 0,
      inputName: response.inputName || response.filename || 'Video',
      outputName: response.outputName,
      createdAt: Date.now(),
      userId: response.userId || userId
    };

    setJobs(prevJobs => {
      const exists = prevJobs.some(j => j.id === newJob.id);
      return exists ? prevJobs : [newJob, ...prevJobs];
    });

    if (socket?.connected) {
      console.log('Subscribing to job:', newJob.id);
      socket.emit('subscribe', newJob.id, userId);
    }

    if (response.formatAdjusted) {
      console.info('ℹ️ Formato ajustado:', response.message);
    }

    setActiveTab('jobs');
  }, [socket, userId]);

  // Cancelar job
  const handleJobCancel = async (jobId) => {
    try {
      await api.cancelJob(jobId);
      setJobs(prevJobs =>
        prevJobs.map(job =>
          job.id === jobId ? { ...job, status: 'cancelled' } : job
        )
      );
      console.log('Job cancelled:', jobId);
    } catch (error) {
      console.error('Error cancelling job:', error);
      alert('Error al cancelar el trabajo');
    }
  };

  // Manejar descarga de job
  const handleJobDownload = useCallback((jobId) => {
    setDownloadedJobs(prev => new Set(prev).add(jobId));
    console.log('Job downloaded:', jobId);
  }, []);

  // Actualizar datos manualmente
  const refreshData = async () => {
    try {
      const [jobsData, healthData] = await Promise.all([
        api.fetchJobs(),
        api.fetchSystemHealth()
      ]);
      setJobs(jobsData);
      setSystemHealth(healthData);
      console.log('Data refreshed');
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  };

  // Limpieza manual de jobs
  const handleCleanupMyJobs = async () => {
    if (!socket?.connected) {
      alert('No hay conexión con el servidor');
      return;
    }

    if (!confirm('¿Limpiar todos tus trabajos? Esto cancelará trabajos activos y eliminará archivos.')) {
      return;
    }

    try {
      socket.emit('cleanup-my-jobs', userId);
      console.log('Cleanup requested for user:', userId);
      
      // Limpiar el estado local
      setTimeout(() => {
        setJobs([]);
        setDownloadedJobs(new Set());
      }, 1000);
    } catch (error) {
      console.error('Error cleaning up jobs:', error);
      alert('Error al limpiar trabajos');
    }
  };

  // Agrupar jobs por estado
  const activeJobs = jobs.filter(job => ['queued', 'processing'].includes(job.status));
  const completedJobs = jobs.filter(job => ['completed', 'failed', 'cancelled'].includes(job.status));
  const finishedJobs = jobs.filter(job => job.status === 'completed');

  // Renderizar contenido de las pestañas
  const renderTabContent = () => {
    if (activeTab === 'upload') {
      return (
        <UploadForm
          presets={presets}
          formats={formats}
          onJobCreated={handleJobCreated}
          userId={userId}
        />
      );
    }

    if (activeTab === 'jobs') {
      return (
        <div className="jobs-section">
          <div className="jobs-header">
            <h2>Trabajos de Conversión</h2>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={refreshData} className="btn-refresh">
                🔄 Actualizar
              </button>
              {jobs.length > 0 && (
                <button 
                  onClick={handleCleanupMyJobs}
                  className="btn-refresh"
                  style={{ background: '#d32f2f' }}
                  title="Cancelar y eliminar todos mis trabajos"
                >
                  🧹 Limpiar Todo
                </button>
              )}
            </div>
          </div>
          
          {jobs.length === 0 ? (
            <div className="no-jobs">
              <p>📁</p>
              <p>No hay trabajos de conversión</p>
              <p style={{ fontSize: '14px', marginTop: '8px', color: '#999' }}>
                Sube un video para comenzar
              </p>
            </div>
          ) : (
            <>
              {activeJobs.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ marginBottom: '12px', color: '#333' }}>
                    En Proceso ({activeJobs.length})
                  </h3>
                  {activeJobs.map(job => (
                    <ProgressBar
                      key={job.id}
                      job={job}
                      onCancel={handleJobCancel}
                      onDownload={handleJobDownload}
                      isDownloaded={downloadedJobs.has(job.id)}
                    />
                  ))}
                </div>
              )}
              
              {completedJobs.length > 0 && (
                <div>
                  <h3 style={{ marginBottom: '12px', color: '#333' }}>
                    Completados ({completedJobs.length})
                  </h3>
                  {completedJobs.map(job => (
                    <ProgressBar
                      key={job.id}
                      job={job}
                      onCancel={handleJobCancel}
                      onDownload={handleJobDownload}
                      isDownloaded={downloadedJobs.has(job.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      );
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>Video Converter Pro</h1>
          <div className="header-subtitle">
            Sistema Avanzado de Conversión de Video - TFG
          </div>
        </div>
        <div className="system-status">
          {systemHealth && (
            <div className={`status-indicator ${systemHealth.status}`}>
              <span className="status-dot"></span>
              Servidor {systemHealth.status === 'healthy' ? 'Operativo' : 'Con Problemas'}
            </div>
          )}
        </div>
      </header>

      <nav className="app-nav">
        <div className="nav-tabs">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`nav-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <span className="tab-icon">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="app-main">
        <div className="content-container">
          {renderTabContent()}
        </div>
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <p>Video Converter Pro - Trabajo Final de Grado</p>
          <div className="footer-stats">
            <span>Trabajos Activos: {activeJobs.length}</span>
            <span>Completados: {finishedJobs.length}</span>
            <span>Total: {jobs.length}</span>
            <span>{socket?.connected ? 'Conectado' : 'Desconectado'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;