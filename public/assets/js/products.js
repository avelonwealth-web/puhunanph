export const PRODUCTS = [
  { id: "rice-01", name: "Rice Seed Batch", amount: 100, rate: 0.1, duration: 5, icon: "🌾" },
  { id: "corn-01", name: "Corn Growth Pack", amount: 250, rate: 0.1, duration: 5, icon: "🌽" },
  { id: "veg-01", name: "Vegetable Greenhouse", amount: 500, rate: 0.1, duration: 10, icon: "🥬" },
  { id: "fruit-01", name: "Fruit Orchard", amount: 800, rate: 0.1, duration: 10, icon: "🍊" },
  { id: "duck-01", name: "Duck Farm Unit", amount: 1000, rate: 0.1, duration: 15, icon: "🦆" },
  { id: "fish-01", name: "Fish Pond Cycle", amount: 1200, rate: 0.1, duration: 15, icon: "🐟" },
  { id: "goat-01", name: "Goat Raising Plan", amount: 1500, rate: 0.1, duration: 15, icon: "🐐" },
  { id: "poultry-01", name: "Poultry Hub", amount: 2000, rate: 0.1, duration: 20, icon: "🐓" },
  { id: "herbs-01", name: "Herbal Garden", amount: 2500, rate: 0.1, duration: 20, icon: "🌿" },
  { id: "bean-01", name: "Coffee Bean Plot", amount: 3000, rate: 0.1, duration: 25, icon: "☕" },
  { id: "cacao-01", name: "Cacao Pod Farm", amount: 4000, rate: 0.1, duration: 30, icon: "🍫" },
  { id: "sugar-01", name: "Sugar Cane Field", amount: 5000, rate: 0.1, duration: 35, icon: "🎋" },
  { id: "mango-01", name: "Mango Orchard", amount: 6500, rate: 0.1, duration: 40, icon: "🥭" },
  { id: "coco-01", name: "Coconut Plantation", amount: 8000, rate: 0.1, duration: 50, icon: "🥥" },
  { id: "premium-01", name: "Premium Agri Estate", amount: 10000, rate: 0.1, duration: 100, icon: "🚜" }
];

export function getProductById(id) {
  return PRODUCTS.find((p) => p.id === id) ?? null;
}
