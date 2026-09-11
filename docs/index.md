---
layout: home
title: Yielded Auth
titleTemplate: false
description: Composable authentication, sessions, and identity workflows for Effect.
sidebar: false
aside: false
pageClass: ea-index
---

<div class="ea-home">
<header class="ea-home__intro">
<h1>Yielded Auth</h1>
<p>Authentication composed with Effect.<br>Keep your identity model. Choose your methods.</p>
<div class="ea-home__actions">
<a href="/guide/getting-started">Get started →</a>
<a href="/guide/authentication">How it fits together →</a>
</div>
</header>

<div class="ea-home__code">

::: code-group

<!--@include: ../README.md#auth-contract-->
<!--@include: ../README.md#auth-server-->
<!--@include: ../README.md#auth-client-->

:::

</div>

<p>One shared contract. Call <code>auth.signIn</code> in a server Effect, <code>client.auth.signIn</code> in a client Effect, or use the generated <code>auth.signIn</code> atom. Supply your account and persistence Layers at the server boundary.</p>

<nav class="ea-home__guides" aria-label="Guides">
<a href="/guide/sessions">Sessions →</a>
<a href="/guide/passkeys">Passkeys →</a>
<a href="/guide/oauth">OAuth →</a>
<a href="/guide/http-and-client">HTTP &amp; client state →</a>
<a href="/guide/examples">Examples →</a>
</nav>
</div>
