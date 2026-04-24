#!/usr/bin/env bash
# deploy.sh — one-shot deploy to local k3s
# Usage: ./deploy.sh [dockerhub_username]
set -e

HUB="${1:-YOUR_DOCKERHUB}"

echo "==> Using Docker Hub username: $HUB"
echo ""

# ── Build & push ──────────────────────────────────────────────────────────────
echo "==> Building Go connector..."
docker build -t "$HUB/connector:v1" ./connector
docker push "$HUB/connector:v1"

echo "==> Building Django frontend..."
docker build -t "$HUB/frontend:v1" ./frontend
docker push "$HUB/frontend:v1"

# ── Patch image names in manifests (temp copies) ─────────────────────────────
sed -i "s|YOUR_DOCKERHUB|$HUB|g" k8s/connector/deployment.yaml
sed -i "s|YOUR_DOCKERHUB|$HUB|g" k8s/frontend/deployment.yaml

# ── Apply manifests ───────────────────────────────────────────────────────────
echo "==> Applying Kubernetes manifests..."
kubectl apply -f k8s/namespace.yaml

kubectl apply -f k8s/postgres/configmap.yaml
kubectl apply -f k8s/postgres/secret.yaml
kubectl apply -f k8s/postgres/pvc.yaml
kubectl apply -f k8s/postgres/deployment.yaml

echo "==> Waiting for PostgreSQL to be ready..."
kubectl wait --for=condition=ready pod -l app=postgres -n appns --timeout=90s

kubectl apply -f k8s/connector/configmap.yaml
kubectl apply -f k8s/connector/deployment.yaml

kubectl apply -f k8s/frontend/configmap.yaml
kubectl apply -f k8s/frontend/secret.yaml
kubectl apply -f k8s/frontend/deployment.yaml

echo ""
echo "==> All done!"
echo ""
kubectl get pods -n appns
echo ""
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
echo "==> Open: http://$NODE_IP:30080"
