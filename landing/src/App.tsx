import { CanvasField } from './components/CanvasField'
import { usePointerField } from './hooks/usePointerField'
import { Rail } from './components/Rail'
import { Hero } from './components/Hero'
import { TwoModes } from './components/TwoModes'
import { Language } from './components/Language'
import { Compile } from './components/Compile'
import { Ownership } from './components/Ownership'
import { Scope } from './components/Scope'
import { Access } from './components/Access'
import { Footer } from './components/Footer'

function App() {
  usePointerField()

  return (
    <>
      <CanvasField />
      <Rail />
      <main>
        <Hero />
        <TwoModes />
        <Language />
        <Compile />
        <Ownership />
        <Scope />
        <Access />
      </main>
      <Footer />
    </>
  )
}

export default App
