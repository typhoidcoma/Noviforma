import { Component } from 'solid-js';
import './App.css';

const App: Component = () => {
  return (
    <div class="app-container">
      <aside class="left-panel">
        <h3>Project / Tags / Shots</h3>
        <p>(Placeholder)</p>
      </aside>

      <main class="center-viewport">
        <div class="viewport-header">
          <h2>GPU Grid Viewport</h2>
        </div>
        <div class="viewport-canvas-container">
          <canvas id="gpu-viewport" />
        </div>
      </main>

      <aside class="right-panel">
        <h3>Inspector</h3>
        <p>(Placeholder)</p>
      </aside>
    </div>
  );
};

export default App;
