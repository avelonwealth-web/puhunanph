FROM node:20-alpine

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN npm --prefix backend install --omit=dev

# Copy backend and public app files
COPY backend ./backend
COPY public ./public

EXPOSE 10000

WORKDIR /app/backend
CMD ["npm", "start"]
