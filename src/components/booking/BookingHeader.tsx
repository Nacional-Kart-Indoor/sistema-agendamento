import logo from '@/assets/logo.png';

export function BookingHeader() {
  return (
    <header className="py-6 px-4 border-b border-border">
      <div className="max-w-6xl mx-auto flex items-center justify-center">
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
      </div>
    </header>
  );
}
