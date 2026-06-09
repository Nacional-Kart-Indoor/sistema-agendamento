import { cn } from '@/lib/utils';
import { BookingStep } from '@/types/booking';
import { Calendar, Settings, User, CreditCard, CheckCircle } from 'lucide-react';

interface StepIndicatorProps {
  currentStep: BookingStep;
}

const steps: { key: BookingStep; label: string; icon: React.ElementType }[] = [
  { key: 'date', label: 'Data', icon: Calendar },
  { key: 'details', label: 'Detalhes', icon: Settings },
  { key: 'customer', label: 'Dados', icon: User },
  { key: 'payment', label: 'Pagamento', icon: CreditCard },
  { key: 'confirmation', label: 'Confirmação', icon: CheckCircle },
];

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  const currentIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="w-full py-6">
      <div className="flex items-center justify-between max-w-2xl mx-auto px-4">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = index === currentIndex;
          const isCompleted = index < currentIndex;
          
          return (
            <div key={step.key} className="flex flex-col items-center relative">
              {/* Connector line */}
              {index > 0 && (
                <div
                  className={cn(
                    "absolute right-1/2 top-5 w-[calc(100%+2rem)] h-0.5 -translate-y-1/2 -z-10",
                    isCompleted ? "bg-primary" : "bg-muted"
                  )}
                  style={{ right: '50%', width: 'calc(100% + 2rem)', marginRight: '-1rem' }}
                />
              )}
              
              {/* Step circle */}
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
                  isActive && "bg-primary text-primary-foreground shadow-lg glow-effect",
                  isCompleted && "bg-primary text-primary-foreground",
                  !isActive && !isCompleted && "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="w-5 h-5" />
              </div>
              
              {/* Step label */}
              <span
                className={cn(
                  "mt-2 text-xs font-medium transition-colors",
                  isActive && "text-primary",
                  isCompleted && "text-foreground",
                  !isActive && !isCompleted && "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
