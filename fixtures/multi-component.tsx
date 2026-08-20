// ===== src/pages/Index.tsx =====
import { Header } from '@/components/Header';
import { Hero } from '@/components/Hero';
import { WhyRealEstate } from '@/components/WhyRealEstate';
import { FinalCTA } from '@/components/FinalCTA';

const Index = () => {
  return (
    <div className="min-h-screen">
      <Header />
      <Hero />
      <WhyRealEstate />
      <FinalCTA />
    </div>
  );
};

export default Index;

// ===== src/components/Header.tsx =====
import { Button } from '@/components/ui/button';

export const Header = () => {
  return (
    <header className="border-b bg-background">
      <nav className="container mx-auto flex items-center justify-between px-6 py-4">
        <span className="text-xl font-bold">EstateGrow</span>
        <Button className="bg-primary px-4 py-2 text-primary-foreground rounded-md">Contact us</Button>
      </nav>
    </header>
  );
};

// ===== src/components/Hero.tsx =====
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import heroImage from '@/assets/hero-city.jpg';

export const Hero = () => {
  return (
    <section className="container mx-auto grid gap-10 px-6 py-20 lg:grid-cols-2">
      <div>
        <h1 className="text-5xl font-extrabold">Build wealth with premium real estate</h1>
        <p className="mt-4 text-lg text-muted-foreground">Fractional ownership in high-growth locations.</p>
        <Button className="mt-8 inline-flex items-center gap-2 bg-primary px-6 py-3 text-primary-foreground rounded-md">
          Start investing
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
      <img src={heroImage} alt="City skyline at dusk" className="rounded-xl object-cover" />
    </section>
  );
};

// ===== src/components/WhyRealEstate.tsx =====
import { TrendingUp, Shield } from 'lucide-react';

const reasons = [
  { icon: TrendingUp, title: 'Appreciation', text: '12% average annual growth across our portfolio.' },
  { icon: Shield, title: 'Stability', text: 'Hard assets that hold value through market cycles.' },
];

export const WhyRealEstate = () => {
  return (
    <section className="bg-secondary/30 py-20">
      <div className="container mx-auto px-6">
        <h2 className="text-center text-3xl font-bold">Why real estate</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-2">
          {reasons.map((r) => (
            <div key={r.title} className="rounded-xl border bg-card p-8">
              <r.icon className="h-10 w-10 text-primary" />
              <h3 className="mt-4 text-xl font-semibold">{r.title}</h3>
              <p className="mt-2 text-muted-foreground">{r.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ===== src/components/FinalCTA.tsx =====
import { Button } from '@/components/ui/button';

export const FinalCTA = () => {
  return (
    <section className="bg-primary py-16 text-center text-primary-foreground">
      <h2 className="text-3xl font-bold">Ready to grow your wealth?</h2>
      <Button className="mt-6 bg-background px-8 py-3 font-semibold text-foreground rounded-md">Book a call</Button>
    </section>
  );
};
