import Dashboard from "./pages/Dashboard";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-100 text-gray-800">
      <header className="bg-indigo-600 text-white p-4 text-xl font-bold shadow">
        🎓 TFG - Conversión y Optimización de Vídeos
      </header>
      <main className="p-6">
        <Dashboard />
      </main>
    </div>
  );
}
