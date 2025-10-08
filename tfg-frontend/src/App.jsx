import React, { useState, useEffect } from 'react';
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
  // Socket.io
  const socket = useSocket('http://localhost:3000');
  
  const [jobs, setJobs] = useState([]);
  const [activeTab, setActiveTab] = useState('upload');
  const [presets, setPresets] = useState({});
  const [formats, setFormats] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);

  // Cargar datos iniciales
  useEffect(() => {
    loadInitialData();
  }, []);

  // Configurar listeners de socket UNA VEZ
  useEffect(() => {
    if (!socket) return;

    // Escuchar actualizaciones de jobs
    socket.on('job:update', handleJobUpdate);

    // Limpieza al cerrar
    return () => {
      socket.off('job:update', handleJobUpdate);
    };
  }, [socket]);

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
    } catch (error) {
      console.error('Error loading initial data:', error);
    }
  };

  const handleJobUpdate = (updatedJob) => {
    setJobs(prevJobs => {
      // Normalizar el ID del job
      const jobId = updatedJob.id || updatedJob.jobId;
      
      // Buscar si el job ya existe
      const jobIndex = prevJobs.findIndex(j => j.id === jobId);
      
      if (jobIndex !== -1) {
        // Actualizar job existente
        const newJobs = [...prevJobs];
        newJobs[jobIndex] = {
          ...newJobs[jobIndex],
          ...updatedJob,
          id: jobId // Mantener el ID consistente
        };
        return newJobs;
      } else {
        // Nuevo job (por si acaso)
        return [...prevJobs, { ...updatedJob, id: jobId }];
      }
    });
  };

  const handleJobCreated = (response) => {
    // Crear objeto de job con estructura consistente
    const newJob = {
      id: response.jobId, // El backend devuelve 'jobId'
      status: response.status || 'queued',
      progress: 0,
      inputName: response.inputName || 'Video',
      createdAt: Date.now()
    };
    
    // Evitar duplicados
    setJobs(prevJobs => {
      const exists = prevJobs.find(j => j.id === newJob.id);
      if (exists) {
        console.warn('Job already exists:', newJob.id);
        return prevJobs;
      }
      return [newJob, ...prevJobs];
    });
    
    // Suscribirse a las actualizaciones del job
    if (socket) {
      socket.emit('subscribe', newJob.id);
    }

    // Cambiar a la pestaña de jobs para ver el progreso
    setActiveTab('jobs');
  };

  const handleJobCancel = async (jobId) => {
    try {
      await api.cancelJob(jobId);
      // La actualización vendrá por socket, pero actualizamos optimísticamente
      setJobs(prevJobs =>
        prevJobs.map(job =>
          job.id === jobId ? { ...job, status: 'cancelled' } : job
        )
      );
    } catch (error) {
      console.error('Error cancelling job:', error);
      alert('Error al cancelar el trabajo');
    }
  };

  const refreshData = async () => {
    try {
      const [jobsData, healthData] = await Promise.all([
        api.fetchJobs(),
        api.fetchSystemHealth()
      ]);
      setJobs(jobsData);
      setSystemHealth(healthData);
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  };

  const activeJobs = jobs.filter(job => ['queued', 'processing'].includes(job.status));
  const completedJobs = jobs.filter(job => ['completed', 'failed', 'cancelled'].includes(job.status));
  const finishedJobs = jobs.filter(job => job.status === 'completed');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'upload':
        return (
          <UploadForm
            presets={presets}
            formats={formats}
            onJobCreated={handleJobCreated}
          />
        );
      
      case 'jobs':
        return (
          <div className="jobs-section">
            <div className="jobs-header">
              <h2>Trabajos de Conversión</h2>
              <button onClick={refreshData} className="btn-refresh">
                🔄 Actualizar
              </button>
            </div>
            
            {jobs.length === 0 ? (
              <div className="no-jobs">
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
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
        
      default:
        return null;
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
              Sistema {systemHealth.status === 'healthy' ? 'Operativo' : 'Con Problemas'}
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
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;