import { AuditIssue } from "@/types";

interface AuditIssuesTableProps {
  issues: AuditIssue[];
}

const severityColors = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-blue-100 text-blue-800",
};

const statusColors = {
  needs_fix: "bg-red-100 text-red-800",
  in_progress: "bg-blue-100 text-blue-800",
  fixed: "bg-green-100 text-green-800",
  monitoring: "bg-gray-100 text-gray-800",
};

export default function AuditIssuesTable({ issues }: AuditIssuesTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-t border-b border-gray-200 bg-gray-50">
            <th className="px-6 py-3 text-left font-semibold text-gray-700">Issue</th>
            <th className="px-6 py-3 text-left font-semibold text-gray-700">Severity</th>
            <th className="px-6 py-3 text-left font-semibold text-gray-700">Status</th>
            <th className="px-6 py-3 text-right font-semibold text-gray-700">Impact</th>
            <th className="px-6 py-3 text-right font-semibold text-gray-700">Action</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-6 py-4">
                <div className="font-semibold text-gray-900">{issue.title}</div>
                <p className="text-xs text-gray-500 mt-1">{issue.description}</p>
              </td>
              <td className="px-6 py-4">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                    severityColors[issue.severity]
                  }`}
                >
                  {issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1)}
                </span>
              </td>
              <td className="px-6 py-4">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                    statusColors[issue.status]
                  }`}
                >
                  {issue.status.replace(/_/g, " ").charAt(0).toUpperCase() + issue.status.slice(1)}
                </span>
              </td>
              <td className="px-6 py-4 text-right">
                <span className="font-semibold text-green-600">+{issue.estimatedImpact}%</span>
              </td>
              <td className="px-6 py-4 text-right">
                <button className="px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 font-semibold text-xs">
                  Details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {issues.length === 0 && (
        <div className="p-8 text-center text-gray-500">
          <p>No issues found. Your tracking is healthy! ✓</p>
        </div>
      )}
    </div>
  );
}
