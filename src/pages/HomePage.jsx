import SiteHeader from '../components/layout/SiteHeader.jsx'
import SiteFooter from '../components/layout/SiteFooter.jsx'
import HeroSection from '../components/sections/HeroSection.jsx'
import PlatformStrip from '../components/sections/PlatformStrip.jsx'
import SolutionsSection from '../components/sections/SolutionsSection.jsx'
import ConnectedSection from '../components/sections/ConnectedSection.jsx'
import ContactSection from '../components/sections/ContactSection.jsx'

function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="top">
        <HeroSection />
        <PlatformStrip />
        <SolutionsSection />
        <ConnectedSection />
        <ContactSection />
      </main>
      <SiteFooter />
    </>
  )
}

export default HomePage
