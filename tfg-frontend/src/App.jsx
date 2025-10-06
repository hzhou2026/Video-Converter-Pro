import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import UploadForm from './componentes/UploadForm';
import ProgressBar from './componentes/ProgressBar';
import ResultsTable from './componentes/ResultsTable';
import MetricsChart from './componentes/MetricsChart';
import Dashboard from './pages/Dashboard';
import './App.css';

function App() {
  const [socket, setSocket] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [activeTab, setActiveTab] = useState('upload');
  const [presets, setPresets] = useState({});
  const [formats, setFormats] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);

  useEffect(() => {
    // Inicializar conexión WebSocket
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    // Cargar datos iniciales
    fetchPresets();
    fetchFormats();
    fetchJobs();
    fetchSystemHealth();

    // Limpiar conexión al desmontar
    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (socket) {
      socket.on('job:update', (updatedJob) => {
        setJobs(prevJobs => 
          prevJobs.map(job => 
            job.id === updatedJob.id ? updatedJob : job
          )
        );
      });
    }
  }, [socket]);

  const fetchPresets = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/presets');
      const data = await response.json();
      setPresets(data);
    } catch (error) {
      console.error('Error fetching presets:', error);
    }
  };

  const fetchFormats = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/formats');
      const data = await response.json();
      setFormats(data);
    } catch (error) {
      console.error('Error fetching formats:', error);
    }
  };

  const fetchJobs = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/jobs');
      const data = await response.json();
      setJobs(data);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    }
  };

  const fetchSystemHealth = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/health');
      const data = await response.json();
      setSystemHealth(data);
    } catch (error) {
      console.error('Error fetching system health:', error);
    }
  };

  const handleJobCreated = (job) => {
    setJobs(prevJobs => [job, ...prevJobs]);
    if (socket) {
      socket.emit('subscribe', job.jobId);
    }
  };

  const handleJobCancel = async (jobId) => {
    try {
      await fetch(`http://localhost:3000/api/job/${jobId}`, {
        method: 'DELETE'
      });
      setJobs(prevJobs => 
        prevJobs.map(job => 
          job.id === jobId ? { ...job, status: 'cancelled' } : job
        )
      );
    } catch (error) {
      console.error('Error cancelling job:', error);
    }
  };

  const tabContent = {
    upload: (
      <UploadForm 
        presets={presets}
        formats={formats}
        onJobCreated={handleJobCreated}
      />
    ),
    jobs: (
      <div className="jobs-section">
        <div className="jobs-header">
          <h2>Trabajos de Conversión</h2>
          <button onClick={fetchJobs} className="btn-refresh">
            Actualizar
          </button>
        </div>
        {jobs.length === 0 ? (
          <div className="no-jobs">
            <p>No hay trabajos de conversión</p>
          </div>
        ) : (
          <>
            {jobs.filter(job => ['queued', 'processing'].includes(job.status)).map(job => (
              <ProgressBar 
                key={job.id}
                job={job}
                onCancel={() => handleJobCancel(job.id)}
              />
            ))}
            <ResultsTable 
              jobs={jobs.filter(job => ['completed', 'failed', 'cancelled'].includes(job.status))}
            />
          </>
        )}
      </div>
    ),
    metrics: (
      <MetricsChart jobs={jobs.filter(job => job.status === 'completed')} />
    ),
    dashboard: (
      <Dashboard 
        jobs={jobs}
        systemHealth={systemHealth}
        onRefresh={() => {
          fetchJobs();
          fetchSystemHealth();
        }}
      />
    )
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
          {[
            { key: 'upload', label: 'Subir y Convertir', icon: '📤' },
            { key: 'jobs', label: 'Trabajos', icon: '⚙️' },
            { key: 'metrics', label: 'Métricas', icon: '📊' },
            { key: 'dashboard', label: 'Dashboard', icon: '🎛️' }
          ].map(tab => (
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
          {tabContent[activeTab]}
        </div>
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <p>Video Converter Pro - Trabajo Final de Grado</p>
          <div className="footer-stats">
            <span>Trabajos Activos: {jobs.filter(j => ['queued', 'processing'].includes(j.status)).length}</span>
            <span>Trabajos Completados: {jobs.filter(j => j.status === 'completed').length}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;