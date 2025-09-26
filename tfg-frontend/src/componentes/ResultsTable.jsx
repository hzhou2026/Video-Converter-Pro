export default function ResultsTable({ results }) {
  const { outputInfo, timeSec, metrics } = results;

  return (
    <table className="w-full border-collapse border text-sm">
      <thead className="bg-gray-100">
        <tr>
          <th className="border p-2">Duración</th>
          <th className="border p-2">Bitrate</th>
          <th className="border p-2">Tiempo (s)</th>
          <th className="border p-2">SSIM</th>
          <th className="border p-2">PSNR</th>
          <th className="border p-2">VMAF</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="border p-2">{outputInfo?.duration?.toFixed(2)} s</td>
          <td className="border p-2">{outputInfo?.bit_rate} bps</td>
          <td className="border p-2">{timeSec}</td>
          <td className="border p-2">{metrics?.ssim}</td>
          <td className="border p-2">{metrics?.psnr}</td>
          <td className="border p-2">{metrics?.vmaf}</td>
        </tr>
      </tbody>
    </table>
  );
}
