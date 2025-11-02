# Backend Dockerfile
FROM node:18-alpine

WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

EXPOSE 3000

# Start the server using npm (which runs wait-for-db.js to wait for the DB)
CMD ["npm", "start"]
