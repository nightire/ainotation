<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
const name = ref('Sam');
const plan = ref('Studio');
const details = ref(false);
</script>

<template>
  <header class="page-header">
    <span class="brand">Ainotation samples</span><span class="framework-badge">Vue</span>
  </header>
  <main>
    <p class="eyebrow">PROJECT / VUE</p>
    <h1 id="sample-heading">Vue project</h1>
    <p class="intro">
      A workspace built with Vue. Select an element or a phrase to leave feedback.
    </p>
    <div class="sample-grid">
      <section class="sample-card" aria-labelledby="workspace-heading">
        <span class="tag">Workspace preview</span>
        <h2 id="workspace-heading">Small steps. Shared progress.</h2>
        <p id="sample-description">
          Bring your team into one thoughtful space. Collect useful ideas, make a plan, and move
          forward together.
        </p>
        <div class="metric">
          <strong id="sample-count">{{ count }}</strong
          ><span>ideas collected</span>
        </div>
        <div class="button-row">
          <button id="increment" class="primary" @click="count++">Add an idea</button>
          <button type="button" disabled>Archive workspace</button>
        </div>
        <button
          id="details-trigger"
          class="text-button"
          :aria-expanded="details"
          aria-controls="sample-details"
          @click="details = !details"
        >
          {{ details ? 'Hide details' : 'Show details' }}
        </button>
        <p v-if="details" id="sample-details" class="detail-box">
          Your workspace includes shared notes, a project board, and a weekly digest.
        </p>
      </section>
      <section class="sample-card" aria-labelledby="profile-heading">
        <span class="tag">Live profile</span>
        <h2 id="profile-heading">Make yourself at home.</h2>
        <label for="display-name">Display name</label>
        <input id="display-name" v-model="name" />
        <label for="plan">Workspace plan</label>
        <select id="plan" v-model="plan">
          <option>Solo</option>
          <option>Team</option>
          <option>Studio</option>
        </select>
        <output id="profile-preview" class="profile-preview"
          >Welcome, {{ name || 'friend' }}. Your {{ plan.toLowerCase() }} workspace is
          ready.</output
        >
      </section>
    </div>
    <p class="testing-note">
      Hold Option/Alt for page interactions. In your Agent, choose project <code>vue</code>.
    </p>
  </main>
</template>
