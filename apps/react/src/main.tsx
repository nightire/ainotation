import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../framework-samples.css';

function App() {
  const [count, setCount] = useState(0);
  const [name, setName] = useState('Alex');
  const [plan, setPlan] = useState('Team');
  const [details, setDetails] = useState(false);
  return (
    <>
      <header className="page-header">
        <span className="brand">Ainotation samples</span>
        <span className="framework-badge">React</span>
      </header>
      <main>
        <p className="eyebrow">PROJECT / REACT</p>
        <h1 id="sample-heading">React project</h1>
        <p className="intro">
          A workspace built with React. Select an element or a phrase to leave feedback.
        </p>
        <div className="sample-grid">
          <section className="sample-card" aria-labelledby="workspace-heading">
            <span className="tag">Workspace preview</span>
            <h2 id="workspace-heading">Make room for your next idea.</h2>
            <p id="sample-description">
              Build a calmer workspace for your team. Keep the important details close and give your
              ideas room to grow.
            </p>
            <div className="metric">
              <strong id="sample-count">{count}</strong>
              <span>ideas collected</span>
            </div>
            <div className="button-row">
              <button
                id="increment"
                className="primary"
                onClick={() => setCount((value) => value + 1)}
              >
                Add an idea
              </button>
              <button type="button" disabled>
                Archive workspace
              </button>
            </div>
            <button
              id="details-trigger"
              className="text-button"
              aria-expanded={details}
              aria-controls="sample-details"
              onClick={() => setDetails((value) => !value)}
            >
              {details ? 'Hide details' : 'Show details'}
            </button>
            {details && (
              <p id="sample-details" className="detail-box">
                Your workspace includes shared notes, a project board, and a weekly digest.
              </p>
            )}
          </section>
          <section className="sample-card" aria-labelledby="profile-heading">
            <span className="tag">Live profile</span>
            <h2 id="profile-heading">A space that feels like you.</h2>
            <label htmlFor="display-name">Display name</label>
            <input
              id="display-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <label htmlFor="plan">Workspace plan</label>
            <select id="plan" value={plan} onChange={(event) => setPlan(event.currentTarget.value)}>
              <option>Solo</option>
              <option>Team</option>
              <option>Studio</option>
            </select>
            <output id="profile-preview" className="profile-preview">
              Welcome, {name || 'friend'}. Your {plan.toLowerCase()} workspace is ready.
            </output>
          </section>
        </div>
        <p className="testing-note">
          Hold Option/Alt for page interactions. In your Agent, choose project <code>react</code>.
        </p>
      </main>
    </>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
import.meta.hot?.dispose(() => root.unmount());
