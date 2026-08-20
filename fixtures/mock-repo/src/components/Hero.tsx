import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import heroImage from '@/assets/hero-city.png';

export const Hero = () => {
  return (
    <section className="hero-section bg-gradient-hero py-20">
      <div className="container grid gap-10 lg:grid-cols-2 items-center">
        <div className="animate-fade-in">
          <span className="text-gold text-sm font-semibold uppercase tracking-wide">Premium investments</span>
          <h1 className="text-5xl font-extrabold text-primary-foreground">Build wealth with premium real estate</h1>
          <p className="mt-4 text-lg text-primary-foreground/80">Fractional ownership in high-growth locations.</p>
          <div className="mt-8 flex gap-4">
            <Button size="lg" className="gap-2">
              Start investing
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="lg">
              Learn more
            </Button>
          </div>
        </div>
        <img src={heroImage} alt="City skyline at dusk" className="rounded-xl object-cover shadow-elegant" />
      </div>
    </section>
  );
};
