import './styles/shared.css'
import { AuthProvider } from './auth/AuthContext.jsx'
import HomePage from './pages/HomePage.jsx'
import CheckoutPage from './pages/CheckoutPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'

function App() {
  if (window.location.pathname === '/checkout' || window.location.pathname === '/payment/finish') {
    return <CheckoutPage />
  }

  let page = <HomePage />
  if (window.location.pathname === '/login') page = <LoginPage />
  if (window.location.pathname === '/profile') page = <ProfilePage />

  return <AuthProvider>{page}</AuthProvider>
}

export default App
