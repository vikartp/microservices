FROM node:20-alpine
WORKDIR /app
COPY package.json index.js /app/
RUN npm install
CMD ["npm", "run", "start"]