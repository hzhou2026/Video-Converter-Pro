import axios from "axios";
import { useState } from "react";

export default function UploadForm({ onNewJob }) {
  const [file, setFile] = useState(null);
  const [preset, setPreset] = useState("h264_fast");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append("video", file);
    formData.append("preset", preset);

    setLoading(true);
    try {
      const res = await axios.post("http://localhost:3000/convert", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onNewJob({ id: res.data.jobId, metrics: null });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white p-6 shadow rounded-xl space-y-4"
    >
      <h2 className="font-bold text-lg">Subir vídeo para conversión</h2>
      <input
        type="file"
        accept="video/*"
        onChange={(e) => setFile(e.target.files[0])}
      />
      <select
        value={preset}
        onChange={(e) => setPreset(e.target.value)}
        className="border p-2 rounded"
      >
        <option value="h264_fast">H.264 Fast</option>
        <option value="h264_balanced">H.264 Balanced</option>
        <option value="av1_balanced">AV1 Balanced</option>
        <option value="web_optimized">Web Optimized</option>
      </select>
      <button
        type="submit"
        disabled={loading}
        className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
      >
        {loading ? "Procesando..." : "Convertir"}
      </button>
    </form>
  );
};
