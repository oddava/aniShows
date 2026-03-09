<p align="center">
  <h1 align="center">AniShows</h1>
  <p align="center">
    <strong>Your personal anime journey.</strong>
  </p>
  <p align="center">
    Track watches, share reviews, and discover new favorites.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.12-blue?style=flat-square&logo=python" alt="Python">
  <img src="https://img.shields.io/badge/Django-5.2-green?style=flat-square&logo=django" alt="Django">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react" alt="React">
</p>

---

## Welcome to AniShows!

Keeping track of what you're watching shouldn't feel like a chore. AniShows is a modern, full-stack platform built to make tracking, reviewing, and discovering anime a beautiful and seamless experience. 

### What you can do:
- **Organize Your Watchlist:** Easily move shows between "Watching", "Completed", "Plan to Watch", and more.
- **Express Yourself:** Write in-depth reviews, rate different aspects (like story, animation, and music), and hide spoilers.
- **Build Your Profile:** Customize your space with avatars, banners, and a hand-picked favorites list.
- **Discover New Shows:** Explore seasonal charts, trending anime, and smart recommendations. Auto-synced with AniList!
- **Easy on the Eyes:** Built with a beautiful glassmorphism aesthetic and dark mode by default.

## Getting Started

Want to run AniShows on your own machine? We've bundled everything up with Docker so you can get started quickly.

**Prerequisites:** You'll need [Docker](https://docs.docker.com/get-docker/), [Docker Compose](https://docs.docker.com/compose/install/), and optionally `make`.

```bash
# 1. Grab the code
git clone https://github.com/oddava/aniShows.git
cd aniShows

# 2. Set up your environment variables
cp .env.example .env

# 3. Build and spin up the containers
make build
make up

# 4. Set up the database
make mig
make superuser
```

That's it! Your local instance should now be running:
- **Frontend App:** http://localhost:5173
- **Backend API:** http://localhost:8000

## Contributing

We love contributions! Whether you're fixing a bug, adding a feature, or just improving some documentation, we'd be thrilled to review your Pull Request. 

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/cool-new-thing`)
3. Commit your changes (`git commit -m 'Add cool new thing'`)
4. Push to the branch (`git push origin feature/cool-new-thing`)
5. Open a Pull Request!

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more information.

<p align="center">
  Made with ❤️ for anime fans by <a href="https://github.com/oddava">oddava</a>
</p>
