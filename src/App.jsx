import './styles/shared.css'
import { AuthProvider } from './auth/AuthContext.jsx'
import HomePage from './pages/HomePage.jsx'
import CheckoutPage from './pages/CheckoutPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import AutomationPage from './pages/AutomationPage.jsx'
import ContactPage from './pages/ContactPage.jsx'

function App() {
  if (window.location.pathname === '/checkout' || window.location.pathname === '/payment/finish') {
    return <CheckoutPage />
  }

  let page = <HomePage />
  if (window.location.pathname === '/login') page = <LoginPage />
  if (window.location.pathname === '/profile') page = <ProfilePage />
  if (window.location.pathname === '/contact') page = <ContactPage />
  if (window.location.pathname === '/workflows' || window.location.pathname === '/automation/finish') {
    page = <AutomationPage />
  }

  return <AuthProvider>{page}</AuthProvider>
}

export default App
