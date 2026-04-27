import { defineCollection, z } from 'astro:content';

const notes = defineCollection({
  schema: z.object({
    title: z.string().optional(),
    date: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    reading_time: z.string().optional(),
  }),
});

const projects = defineCollection({
  schema: z.object({
    title: z.string(),
    status: z.string(),
    tags: z.array(z.string()).optional(),
    icon: z.string().optional(),
    tagline: z.string().optional(),
    sort: z.number().optional(),
  }),
});

const wiki = defineCollection({
  schema: z.object({
    title: z.string(),
    date: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    pdf: z.string().optional(),
  }),
});

const home = defineCollection({
  schema: z.object({
    name: z.string().optional(),
    greeting: z.string().optional(),
    bio: z.string().optional(),
    work: z.string().optional(),
    email: z.string().optional(),
    github: z.string().optional(),
    twitter: z.string().optional(),
    footer: z.string().optional(),
  }),
});

export const collections = { notes, projects, wiki, home };
