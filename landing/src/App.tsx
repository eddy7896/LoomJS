import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { HowItWorks } from './components/HowItWorks'
import { Features } from './components/Features'
import { NodeShowcase } from './components/NodeShowcase'
import { TechStack } from './components/TechStack'
import { ForDesigners } from './components/ForDesigners'
import { WaitlistCTA } from './components/WaitlistCTA'
import { Footer } from './components/Footer'

function App() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <NodeShowcase />
        <TechStack />
        <ForDesigners />
        <WaitlistCTA />
      </main>
      <Footer />
    </>
  )
}

export default App
