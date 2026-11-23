export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          maxWidth: '600px',
        }}
      >
        <h1
          style={{
            fontSize: '3rem',
            fontWeight: '700',
            marginBottom: '1rem',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          FinCore
        </h1>
        <p
          style={{
            fontSize: '1.25rem',
            color: '#666',
            marginBottom: '2rem',
          }}
        >
          Digital Wallet, Ledger & Payment Processing Platform
        </p>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <a
            href="/api/health"
            style={{
              padding: '0.75rem 1.5rem',
              background: '#667eea',
              color: 'white',
              borderRadius: '0.5rem',
              fontWeight: '500',
            }}
          >
            API Health Check
          </a>
          <a
            href="http://localhost:8000/health"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '0.75rem 1.5rem',
              background: '#764ba2',
              color: 'white',
              borderRadius: '0.5rem',
              fontWeight: '500',
            }}
          >
            Analytics Health Check
          </a>
        </div>
        <div
          style={{
            marginTop: '3rem',
            padding: '1.5rem',
            background: '#f5f5f5',
            borderRadius: '0.5rem',
            textAlign: 'left',
          }}
        >
          <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>Service Status</h2>
          <ul style={{ listStyle: 'none', lineHeight: '2' }}>
            <li>
              ✅ Frontend (Next.js) - <code>localhost:3000</code>
            </li>
            <li>
              ✅ Backend API (Express) - <code>localhost:4000</code>
            </li>
            <li>
              ✅ Analytics (FastAPI) - <code>localhost:8000</code>
            </li>
            <li>
              ✅ PostgreSQL - <code>localhost:5432</code>
            </li>
            <li>
              ✅ Redis - <code>localhost:6379</code>
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
