import { Check } from "lucide-react";

interface Step {
  label: string;
  optional?: boolean;
}

interface Props {
  steps: Step[];
  current: number;
  skipped?: Set<number>;
}

export default function WizardStepper({ steps, current, skipped }: Props) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((step, i) => {
        const isCompleted = i < current && !skipped?.has(i);
        const isSkipped = skipped?.has(i);
        const isActive = i === current;
        return (
          <div key={i} className="flex items-center gap-1 flex-1">
            <div className="flex items-center gap-2 flex-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  isCompleted
                    ? "bg-green-600 text-white"
                    : isSkipped
                    ? "bg-gray-300 text-gray-500"
                    : isActive
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-500"
                }`}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <div className="min-w-0">
                <div className={`text-xs font-semibold truncate ${isActive ? "text-blue-700" : isCompleted ? "text-green-700" : "text-gray-500"}`}>
                  {step.label}
                </div>
                {step.optional && (
                  <div className="text-[10px] text-gray-400">Optional</div>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 min-w-4 ${i < current ? "bg-green-400" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
