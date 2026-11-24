import { MapPin } from 'lucide-react';
import logo from '@/assets/logo.png';

export function BookingHeader() {
  return (
    <header className="py-6 px-4 border-b border-border">
      <div className="max-w-6xl mx-auto flex flex-col items-center gap-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-lg overflow-hidden glow-effect">
            <img 
              src={logo} 
              alt="Nacional Kart Indoor Logo" 
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <h1 className="text-2xl font-racing font-bold racing-text-gradient">
              NACIONAL KART INDOOR
            </h1>
            <p className="text-xs text-muted-foreground tracking-widest uppercase">
              Agendamento Online
            </p>
          </div>
        </div>

        <div
          role="note"
          aria-label="Unidade Goiânia, Shopping Cerrado"
          className="w-full max-w-md flex items-center gap-4 border-2 border-secondary bg-secondary/10 rounded-xl px-4 py-3"
        >
          <div className="w-11 h-11 shrink-0 rounded-full bg-secondary flex items-center justify-center">
            <MapPin className="w-6 h-6 text-secondary-foreground" />
          </div>
          <div>
            <p className="font-racing text-2xl font-bold text-secondary uppercase leading-tight">
              GOIÂNIA – GO
            </p>
            <p className="font-semibold text-base text-foreground">
              Shopping Cerrado
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
