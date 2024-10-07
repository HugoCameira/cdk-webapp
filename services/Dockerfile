# Use the official Node.js image as the base image
FROM --platform=linux/x86-64 node

# Set the working directory in the container
WORKDIR /app

# Copy the package.json and package-lock.json files to the container
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code to the container
COPY . .

# Expose port 80
EXPOSE 80

# Start the application
CMD ["npx", "ts-node", "app.ts"]