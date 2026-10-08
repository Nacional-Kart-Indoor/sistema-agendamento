import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AtendenteLogin from "./pages/atendente/Login";
import Presenca from "./pages/atendente/Presenca";
import AdminDashboard from "./pages/admin/Dashboard";
import ReservationPilots from "./pages/ReservationPilots";
import { MetaPixelRouteTracker } from "@/components/MetaPixelRouteTracker";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <MetaPixelRouteTracker />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/atendente/login" element={<AtendenteLogin />} />
          <Route path="/atendente/presenca" element={<Presenca />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/reserva/:token/pilotos" element={<ReservationPilots />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
