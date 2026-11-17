import './styles/shared.css'
import HomePage from './pages/HomePage.jsx'
import CheckoutPage from './pages/CheckoutPage.jsx'

function App() {
  if (window.location.pathname === '/checkout' || window.location.pathname === '/payment/finish') {
    return <CheckoutPage />
  }

  return <HomePage />
}

export default App
