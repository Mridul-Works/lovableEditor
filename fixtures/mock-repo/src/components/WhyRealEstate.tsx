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
