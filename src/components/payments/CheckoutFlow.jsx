import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import StripeCardForm from './StripeCardForm.jsx';
import { Confetti } from '../common/Confetti.jsx';

const PLANS = [
  { label: 'Básico',  price: '$9.99',  value: 'basico', features: ['Acceso a recursos', 'Lecciones guiadas', 'Comunidad privada'] },
  { label: 'Pro',     price: '$24.99', value: 'pro',    features: ['Feedback de IA', 'Clases 1:1', 'Partituras exclusivas'] },
  { label: 'Master',  price: '$49.99', value: 'master', features: ['Plan personalizado', 'Sesiones premium', 'Análisis avanzado'] },
];

const STORAGE_KEY = 'checkout_plan';

const SecureBadge = () => (
  <p className="checkout-secure">
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2l7 3v6c0 4.5-3 8.5-7 9-4-.5-7-4.5-7-9V5l7-3z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    Pago seguro · Stripe
  </p>
);

export const CheckoutFlow = ({ initialPlan, onComplete, renderPaymentForm }) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) return 'review';
    if (initialPlan) return 'review';
    return 'select_plan';
  });
  const [selectedPlan, setSelectedPlan] = useState(() => {
    return initialPlan || sessionStorage.getItem(STORAGE_KEY) || null;
  });
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    if (selectedPlan) {
      sessionStorage.setItem(STORAGE_KEY, selectedPlan);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [selectedPlan]);

  const planData = PLANS.find((p) => p.label === selectedPlan || p.value === selectedPlan);

  if (succeeded && planData) {
    return (
      <div className="checkout-step">
        <Confetti />
        <div className="checkout-success">
          <div className="checkout-success-check" aria-hidden="true">✓</div>
          <h3>¡Bienvenido a {planData.label}!</h3>
          <p>Tu método de pago se registró correctamente. Ya puedes disfrutar de tu plan.</p>
        </div>
      </div>
    );
  }

  // Step 1: select_plan
  if (step === 'select_plan') {
    return (
      <div className="checkout-step">
        <div className="checkout-head">
          <h3>Selecciona tu plan</h3>
          <p>Elige el plan que mejor se adapta a tu ritmo de aprendizaje.</p>
        </div>
        <div className="checkout-plans">
          {PLANS.map((plan) => (
            <button
              key={plan.value}
              type="button"
              className={`checkout-plan-card ${selectedPlan === plan.value ? 'active' : ''}`}
              onClick={() => { setSelectedPlan(plan.value); }}
            >
              <strong>{plan.label}</strong>
              <span className="checkout-price">{plan.price}</span>
            </button>
          ))}
        </div>
        <button
          className="button button-primary button-block"
          disabled={!selectedPlan}
          onClick={() => {
            if (!user) {
              sessionStorage.setItem('checkout_resume', '1');
              const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
              navigate(`/auth/login?returnTo=${returnTo}`);
              return;
            }
            setStep('review');
          }}
        >
          {user ? 'Continuar' : 'Inicia sesión para continuar'}
        </button>
        <SecureBadge />
      </div>
    );
  }

  // Step 2: review
  if (step === 'review' && planData) {
    return (
      <div className="checkout-step">
        <div className="checkout-head">
          <h3>Revisa tu compra</h3>
          <p>Confirma los detalles antes de continuar al pago.</p>
        </div>
        <div className="checkout-plan-summary">
          <div>
            <div className="plan-name">Plan {planData.label}</div>
            <div className="text-muted" style={{ fontSize: '0.85rem' }}>Facturación mensual · USD</div>
          </div>
          <div className="plan-cost">{planData.price}</div>
        </div>
        {planData.features && (
          <ul className="lp-plan" style={{ background: 'transparent', border: 'none', padding: 0, boxShadow: 'none', margin: '0 0 1rem' }}>
            {planData.features.map((f) => (
              <li key={f}><span className="lp-check" aria-hidden="true">✓</span>{f}</li>
            ))}
          </ul>
        )}
        <div className="checkout-summary">
          <div className="checkout-summary-row">
            <span>Cuenta</span>
            <span>{user?.email}</span>
          </div>
        </div>
        <div className="checkout-actions">
          <button className="button button-secondary" onClick={() => setStep('select_plan')}>
            Atrás
          </button>
          <button className="button button-primary" onClick={() => setStep('payment_method')}>
            Ir a pagar
          </button>
        </div>
        <SecureBadge />
      </div>
    );
  }

  // Step 3: payment_method (tokenized securely by Stripe Elements)
  if (step === 'payment_method' && planData) {
    const handlePaymentSuccess = () => {
      sessionStorage.removeItem(STORAGE_KEY);
      setSucceeded(true);
      setTimeout(() => onComplete?.(), 2400);
    };

    const paymentForm = renderPaymentForm
      ? renderPaymentForm({ plan: planData, onSuccess: handlePaymentSuccess })
      : (
        <StripeCardForm
          submitLabel="Pagar ahora"
          successMessage={`Método de pago del plan ${planData.label} enviado correctamente.`}
          onSuccess={handlePaymentSuccess}
        />
      );

    return (
      <div className="checkout-step">
        <div className="checkout-head">
          <h3>Método de pago</h3>
          <p>Tus datos se envían cifrados directamente a Stripe.</p>
        </div>
        <div className="checkout-plan-summary">
          <div className="plan-name">Plan {planData.label}</div>
          <div className="plan-cost">{planData.price}</div>
        </div>
        {paymentForm}
        <button type="button" className="button button-ghost button-block" onClick={() => setStep('review')}>
          Atrás
        </button>
        <SecureBadge />
      </div>
    );
  }

  return null;
};

export default CheckoutFlow;
