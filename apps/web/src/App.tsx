import { Result } from 'antd';
import { Route, Routes } from 'react-router-dom';

/**
 * F1 placeholder home. Real pages (/login, /campaigns, /campaigns/new,
 * /campaigns/:id) land in F4. The single route below proves the toolchain
 * (Vite + React Router + AntD) is wired correctly.
 */
function Home() {
  return (
    <Result
      status="info"
      title="Mini Campaign Manager"
      subTitle="Scaffold ready. Pages land in F4."
    />
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
