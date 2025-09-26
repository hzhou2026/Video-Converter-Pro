import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function MetricsChart({ metrics }) {
  const data = {
    labels: ["SSIM", "PSNR", "VMAF"],
    datasets: [
      {
        label: "Calidad",
        data: [metrics?.ssim, metrics?.psnr, metrics?.vmaf],
        backgroundColor: ["#4f46e5", "#22c55e", "#f59e0b"],
      },
    ],
  };

  return (
    <div className="p-4">
      <Bar data={data} />
    </div>
  );
};
