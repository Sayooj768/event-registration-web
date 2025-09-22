import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import RegistrationForm from './RegistrationForm';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/event/:id" element={<RegistrationForm />} />
          <Route path="/" element={
            <div className="container">
              <h1>Event Registration Portal</h1>
              <p>Please use the specific link provided for your event.</p>
            </div>
          } />
        </Routes>
      </div>
    </Router>
  );
}

export default App;