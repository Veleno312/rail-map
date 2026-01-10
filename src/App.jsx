import { useEffect, useState } from "react";

function App() {
  const [nodes, setNodes] = useState([]);

  useEffect(() => {
    fetch("/comarca_nodes.json")
      .then(res => res.json())
      .then(data => {
        console.log("Loaded nodes:", data.length);
        setNodes(data);
      })
      .catch(err => console.error(err));
  }, []);

  return (
    <div style={{ padding: "1rem" }}>
      <h1>Comarca nodes</h1>
      <p>Loaded: {nodes.length}</p>

      <ul>
        {nodes.slice(0, 5).map(n => (
          <li key={n.id}>
            {n.name} ({n.lat.toFixed(2)}, {n.lon.toFixed(2)})
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;