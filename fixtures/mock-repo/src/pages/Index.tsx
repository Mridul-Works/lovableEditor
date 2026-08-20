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
