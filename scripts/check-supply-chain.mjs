import { readFileSync } from 'node:fs';

const composeFiles = ['infra/local/docker-compose.yml', 'simulador/docker-compose.yml'];

for (const file of composeFiles) {
  const content = readFileSync(file, 'utf8');
  const images = [...content.matchAll(/^\s*image:\s*(\S+)$/gm)].map((match) => match[1]);

  if (images.length === 0) throw new Error(`${file} does not declare any images`);
  for (const image of images) {
    if (!/@sha256:[a-f0-9]{64}$/.test(image)) {
      throw new Error(`${file} image is not digest-pinned: ${image}`);
    }
    if (image.includes(':latest')) {
      throw new Error(`${file} must not use a latest image tag: ${image}`);
    }
  }

  for (const port of content.matchAll(/^\s*-\s*"([^"]+)"$/gm)) {
    const mapping = port[1];
    if (/^\d+:\d+$/.test(mapping)) {
      throw new Error(`${file} publishes a port on every interface: ${mapping}`);
    }
  }
}

console.log('Supply-chain container pinning checks passed.');
